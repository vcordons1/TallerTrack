import { createHash } from "node:crypto";
import oracledb from "oracledb";
import { mapOracleQueryError } from "../../platform/oracle-query.js";
import { IdentityError } from "./identity-service.js";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function createInternalUsers({ poolManager, schema, credentials, passwords, maxConcurrency, driver = oracledb }) {
  if (!/^[A-Z][A-Z0-9_$#]{0,29}$/.test(schema) || !Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new TypeError("Invalid internal user configuration");
  }
  let hashing = 0;
  async function bounded(work) {
    if (hashing >= maxConcurrency) throw new IdentityError("DEMASIADAS_SOLICITUDES");
    hashing += 1;
    try { return await work(); } finally { hashing -= 1; }
  }
  const out = (maxSize) => ({ dir: driver.BIND_OUT, type: driver.STRING, maxSize });
  return Object.freeze({
    async read({ actorId, sessionId, id = null, q = null, active = null, role = null, position = null, limit = 25 }) {
      const connection = await poolManager.getConnection();
      let cursor;
      try {
        const result = await connection.execute(`BEGIN ${schema}.pkg_usuarios_internos.consultar(
          :actor,:sessionId,:id,:q,:active,:role,:dateAfter,:idAfter,:maximum,:result); END;`, {
          actor: actorId, sessionId, id, q, active: active == null ? null : Number(active), role,
          dateAfter: position?.date ?? null, idAfter: position?.id ?? null, maximum: limit + 1,
          result: { dir: driver.BIND_OUT, type: driver.CURSOR },
        }, { outFormat: driver.OUT_FORMAT_OBJECT, autoCommit: false });
        cursor = result.outBinds.result;
        return (await cursor.getRows(limit + 1)).map((r) => ({ id: r.ID, version: r.VERSION,
          login: r.LOGIN, nombreMostrado: r.NOMBRE, activo: r.ACTIVO === 1,
          roles: JSON.parse(r.ROLES || "[]"), _position: { date: r.FECHA, id: r.ID } }));
      } catch (error) { throw mapOracleQueryError(error); }
      finally { try { if (cursor) await cursor.close(); } finally { await connection.close(); } }
    },
    async command({ operation, actorId, sessionId, id = null, body, key, correlationId }) {
      // Credentials never enter COMANDO, its digest, audit, or persisted command result.
      const { password, ...material } = body;
      const passwordHash = operation === "I11" ? await bounded(() => passwords.hash(password)) : null;
      const hash = createHash("sha256").update(canonical({ operation, id, ...material })).digest();
      const connection = await poolManager.getConnection();
      let result;
      try {
        const executed = await connection.execute(`BEGIN ${schema}.pkg_usuarios_internos.ejecutar(
          :operation,:actor,:sessionId,:id,:version,:login,:name,:roles,:credential,:reason,
          :key,:hash,:correlation,:result,:repeated,:commandId,:dateAt); END;`, {
          operation, actor: actorId, sessionId, id, version: body.versionEsperada ?? null,
          login: body.login ?? null, name: body.nombreMostrado ?? null,
          roles: body.roles ? JSON.stringify(body.roles) : null, credential: passwordHash,
          reason: body.motivo ?? null, key, hash, correlation: correlationId,
          result: out(4000), repeated: { dir: driver.BIND_OUT, type: driver.NUMBER },
          commandId: out(40), dateAt: out(40),
        }, { autoCommit: false });
        result = { data: JSON.parse(executed.outBinds.result), repeated: executed.outBinds.repeated === 1,
          commandId: executed.outBinds.commandId, confirmedAt: executed.outBinds.dateAt };
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw mapOracleQueryError(error);
      } finally { await connection.close(); }
      if (operation === "I11" && result.repeated) {
        // Verify against the authoritative salted credential after releasing locks.
        // A changed password cannot replay the creation or replace its credential.
        const credential = await credentials.findInternalCredential(body.login);
        if (!credential || String(credential.userId) !== result.data.usuarioId
          || !(await bounded(() => passwords.verify(credential.passwordHash, password)))) {
          throw Object.assign(new Error("Creation credential does not match"), { code: "CLAVE_REUTILIZADA" });
        }
      }
      return result;
    },
  });
}
