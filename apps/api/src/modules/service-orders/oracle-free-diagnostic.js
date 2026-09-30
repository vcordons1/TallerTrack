import { createHash } from "node:crypto";

import oracledb from "oracledb";

import { mapOracleQueryError } from "../../platform/oracle-query.js";

const IDENTIFIER = /^[A-Z][A-Z0-9_$#]{0,29}$/;
const READS = Object.freeze({ directory: "directorio", participants: "participantes",
  works: "trabajos", diagnoses: "diagnosticos" });

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function clobString(value) {
  if (value == null || typeof value === "string") return value;
  try { return await value.getData(); } finally { await value.close(); }
}

export function createOracleFreeDiagnostic({ poolManager, schema, driver = oracledb }) {
  if (!poolManager || typeof poolManager.getConnection !== "function"
    || typeof schema !== "string" || !IDENTIFIER.test(schema)) {
    throw new TypeError("Free diagnostic Oracle dependencies are invalid");
  }
  const packageName = `${schema}.pkg_diagnostico_gratuito`;
  return Object.freeze({
    async read(kind, { actorId, sessionId, orderId, q = null, active = null, afterId = null, limit = 25 }) {
      const procedure = READS[kind];
      if (!procedure) throw new TypeError("Unknown diagnostic read");
      const extra = kind === "directory" ? { q }
        : kind === "participants" ? { active: active === null ? null : Number(active) } : {};
      const connection = await poolManager.getConnection();
      let cursor;
      try {
        const binds = { actor: actorId, session: sessionId, order: orderId,
          ...extra, afterId, maximum: limit + 1,
          result: { dir: driver.BIND_OUT, type: driver.CURSOR } };
        const result = await connection.execute(
          `BEGIN ${packageName}.${procedure}(${Object.keys(binds).map((key) => `:${key}`).join(",")}); END;`,
          binds, { autoCommit: false, outFormat: driver.OUT_FORMAT_OBJECT },
        );
        cursor = result.outBinds.result;
        const rows = await cursor.getRows(limit + 1);
        const converted = [];
        for (const source of rows) {
          const row = Object.fromEntries(Object.entries(source).map(([key, value]) => [key.toLowerCase(), value]));
          if (kind === "directory") converted.push({ id: row.id, nombre: row.nombre });
          else if (kind === "participants") converted.push({
            id: row.id, mecanico: { id: row.mecanico_id, nombre: row.mecanico_nombre },
            asignadoEn: row.asignado_en, retiradoEn: row.retirado_en,
            motivoRetiro: row.motivo_retiro,
          });
          else if (kind === "works") converted.push({
            id: row.id, version: row.version, tipo: row.tipo,
            tipoServicio: row.tipo_servicio, descripcion: row.descripcion,
            estado: row.estado, diagnosticoGratuito: row.diagnostico_gratuito === 1,
            horasEjecutadas: "0.00", alcance: [],
          });
          else {
            const detail = row.puede_ver_detalle === 1 ? await clobString(row.detalle_tecnico) : null;
            if (row.puede_ver_detalle !== 1 && row.detalle_tecnico?.close) await row.detalle_tecnico.close();
            converted.push({
            id: row.id, numeroRevision: row.numero_revision,
            revisionAnteriorId: row.revision_anterior_id,
            trabajoDiagnosticoId: row.trabajo_diagnostico_id,
            detalleTecnico: detail,
            resumenCliente: row.resumen_cliente, confirmadoEn: row.confirmado_en,
            });
          }
        }
        return converted;
      } catch (error) { throw mapOracleQueryError(error); }
      finally { if (cursor) await cursor.close(); await connection.close(); }
    },
    async command({ operation, actorId, sessionId, orderId, destinationId = null,
      resourceId = null, version = null, type = null, service = null,
      description = null, free = null, detail = null, summary = null, reason = null,
      idempotencyKey, correlationId, material }) {
      const hash = createHash("sha256").update(canonical({ orderId, ...material })).digest();
      const connection = await poolManager.getConnection();
      let committed = false;
      try {
        const result = await connection.execute(`BEGIN ${packageName}.ejecutar(
          :operation,:actor,:session,:orderId,:destinationId,:resourceId,:version,
          :type,:service,:description,:free,:detail,:summary,:reason,
          :scope,:key,:hash,:correlation,:result,:repeated,:commandId,:confirmedAt
        ); END;`, {
          operation, actor: actorId, session: sessionId, orderId,
          destinationId, resourceId, version, type, service, description,
          free, detail: detail == null ? null : { dir: driver.BIND_IN, type: driver.CLOB, val: detail },
          summary, reason, scope: `actor:${actorId}/${operation}`, key: idempotencyKey,
          hash, correlation: correlationId,
          result: { dir: driver.BIND_OUT, type: driver.CLOB },
          repeated: { dir: driver.BIND_OUT, type: driver.NUMBER },
          commandId: { dir: driver.BIND_OUT, type: driver.STRING, maxSize: 40 },
          confirmedAt: { dir: driver.BIND_OUT, type: driver.STRING, maxSize: 40 },
        }, { autoCommit: false });
        const data = JSON.parse(await clobString(result.outBinds.result));
        await connection.commit();
        committed = true;
        return { data, repeated: result.outBinds.repeated === 1,
          commandId: result.outBinds.commandId, confirmedAt: result.outBinds.confirmedAt };
      } catch (error) {
        if (!committed) await connection.rollback();
        throw mapOracleQueryError(error);
      } finally { await connection.close(); }
    },
  });
}
