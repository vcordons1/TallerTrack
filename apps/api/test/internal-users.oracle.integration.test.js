import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import oracledb from "oracledb";
import { createApp } from "../src/app.js";
import { createIdentityService } from "../src/modules/identity/identity-service.js";
import { createOracleIdentityRepository } from "../src/modules/identity/oracle-identity-repository.js";
import { createInternalUsers } from "../src/modules/identity/internal-users.js";
import { createPasswordService } from "../src/modules/identity/passwords.js";
import { createTokenService } from "../src/modules/identity/tokens.js";
import { createOraclePoolManager } from "../src/platform/oracle-pool.js";
import { createOpaqueCursorCodec } from "../src/platform/operational-query-contract.js";
import { loadAuthConfig } from "../src/platform/config.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createApiClient } = require("../../mobile/src/api/client.cjs");
const { getInternalDestinations } = require("../../mobile/src/navigation/accessPolicy.js");

test("I10-I14 real Oracle: creation/login, live authority, replay, history, rollback and races", {
  skip: process.env.TT_RUN_USERS_ORACLE_INTEGRATION !== "1", timeout: 120000,
}, async (t) => {
  const schema = process.env.TT_ORACLE_SCHEMA;
  const owner = await oracledb.getConnection({ user: process.env.TT_DB_USER,
    password: process.env.TT_DB_PASSWORD, connectString: process.env.TT_ORACLE_CONNECT_STRING });
  t.after(() => owner.close());
  const poolManager = createOraclePoolManager({ driver: oracledb, config: {
    user: process.env.TT_ORACLE_USER, password: process.env.TT_ORACLE_PASSWORD,
    connectString: process.env.TT_ORACLE_CONNECT_STRING, poolMin: 0, poolMax: 6,
    poolIncrement: 1, queueTimeout: 5000, poolTimeout: 60,
  } });
  await poolManager.initialize(); t.after(() => poolManager.close());
  const passwords = createPasswordService();
  const password = randomBytes(24).toString("base64url");
  const hash = await passwords.hash(password);
  await owner.execute(`BEGIN pkg_identidad_bootstrap.crear_usuario_interno(
    'admin.test','Administrador',:hash,'["ADMINISTRADOR","RECEPCIONISTA"]',:id); END;`, {
    hash, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  });
  await owner.commit();
  const config = loadAuthConfig({ TT_AUTH_SIGNING_KEY_BASE64: randomBytes(32).toString("base64"),
    TT_AUTH_ISSUER: "users-test", TT_AUTH_AUDIENCE: "users-test", TT_AUTH_LOGIN_MAX_ATTEMPTS: "100" });
  const credentials = createOracleIdentityRepository({ poolManager, schema });
  const identityService = await createIdentityService({ repository: credentials, passwordService: passwords,
    tokenService: createTokenService({ config }), authConfig: config });
  const logs = [];
  const app = createApp({ identityService,
    internalUsers: createInternalUsers({ poolManager, schema, credentials, passwords, maxConcurrency: 4 }),
    cursorCodec: createOpaqueCursorCodec({ hmacKey: config.signingKey }), logger: { error: (data) => logs.push(data) } });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function request(path, { token, body, key = randomUUID() } = {}) {
    const response = await fetch(base + path, { method: body ? "POST" : "GET",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json", "Idempotency-Key": key } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    const payload = response.status === 204 ? null : await response.json();
    if (!path.startsWith("/acceso/sesiones")) {
      assert.equal(JSON.stringify(payload).includes(password), false);
      assert.equal(JSON.stringify(payload).includes("$argon2"), false);
    }
    return { status: response.status, ...payload, location: response.headers.get("location") };
  }
  const login = (name, pass = password) => request("/acceso/sesiones", { body: { login: name, password: pass } });
  const adminLogin = await login("admin.test"); assert.equal(adminLogin.status, 201);
  let token = adminLogin.data.tokens.accessToken;
  const adminId = adminLogin.data.acceso.usuarioId;
  const users = "/interno/usuarios";
  const createBody = { login: "employee.test", nombreMostrado: "Empleado nuevo", roles: ["RECEPCIONISTA"], password };
  const createKey = randomUUID();
  let employeeId; let employeeToken;
  await t.test("non-enumerating login, strict role/body validation and last administrator", async () => {
    const bad = await login("admin.test", "incorrect-password");
    const missing = await login("missing.test", "incorrect-password");
    assert.equal(bad.status, 401); assert.equal(missing.status, 401);
    assert.equal(bad.error.code, missing.error.code); assert.equal(bad.error.message, missing.error.message);
    for (const roles of [[], ["CLIENTE"], ["INVALID"], ["MECANICO", "MECANICO"]]) {
      assert.ok([400, 422].includes((await request(users, { token, body: { ...createBody, roles } })).status));
    }
    assert.equal((await request(users, { token, body: { ...createBody, actorId: adminId } })).status, 400);
    assert.equal((await request(`/acceso/yo?roles=ADMINISTRADOR`, { token })).status, 400);
    for (const action of ["cambiar-roles", "desactivar"]) {
      const result = await request(`${users}/${adminId}/${action}`, { token, body: {
        versionEsperada: "1", motivo: "Protección", ...(action === "cambiar-roles" ? { roles: ["RECEPCIONISTA"] } : {}),
      } });
      assert.equal(result.status, 422); assert.equal(result.error.code, "ULTIMO_ADMINISTRADOR");
    }
  });
  await t.test("concurrent creation, same-key replay and different payload/password", async () => {
    const pair = await Promise.all([1, 2].map(() => request(users, { token, body: createBody, key: createKey })));
    for (const r of pair) assert.equal(r.status, 201, JSON.stringify(r));
    assert.deepEqual(pair.map((r) => r.meta.repetido).sort(), [false, true]);
    employeeId = pair[0].data.usuarioId;
    assert.equal(pair[0].location, `${users.replace('/interno','/api/v1/interno')}/${employeeId}`);
    assert.equal(pair[1].data.usuarioId, employeeId);
    for (const body of [{ ...createBody, nombreMostrado: "Otro" }, { ...createBody, password: "changed-password-value" }]) {
      const r = await request(users, { token, body, key: createKey });
      assert.equal(r.status, 409); assert.equal(r.error.code, "CLAVE_REUTILIZADA");
    }
    const duplicate = await request(users, { token, body: createBody });
    assert.equal(duplicate.status, 409); assert.equal(duplicate.error.code, "REFERENCIA_DUPLICADA");
    const employeeLogin = await login(createBody.login); assert.equal(employeeLogin.status, 201);
    employeeToken = employeeLogin.data.tokens.accessToken;
    assert.deepEqual((await request("/acceso/yo", { token: employeeToken })).data.roles, ["RECEPCIONISTA"]);
    for (const [path, body] of [[users], [`${users}/${adminId}`], [users, createBody],
      [`${users}/${adminId}/cambiar-roles`, { versionEsperada: "1", roles: ["ADMINISTRADOR"], motivo: "Ataque" }],
      [`${users}/${adminId}/desactivar`, { versionEsperada: "1", motivo: "Ataque" }]]) {
      assert.equal((await request(path, { token: employeeToken, body })).status, 403);
    }
  });
  await t.test("real list/detail, cursor binding and optimistic roles with history", async () => {
    const first = await request(`${users}?limite=1`, { token });
    assert.equal(first.status, 200); assert.equal(first.page.hayMas, true);
    const cursor = encodeURIComponent(first.page.siguienteCursor);
    assert.equal((await request(`${users}?cursor=${cursor}&activo=true`, { token })).error.code, "CURSOR_INVALIDO");
    const next = await request(`${users}?limite=1&cursor=${cursor}`, { token });
    assert.notEqual(next.data[0].id, first.data[0].id);
    assert.equal((await request(`${users}?q=Empleado`, { token })).data[0].id, employeeId);
    assert.equal((await request(`${users}?q=%25%25`, { token })).data.length, 0);
    assert.equal((await request(`${users}/${employeeId}`, { token })).data.login, createBody.login);
    const body = { versionEsperada: "1", roles: ["ADMINISTRADOR", "MECANICO"], motivo: "Cambio de función" };
    const key = randomUUID(); const path = `${users}/${employeeId}/cambiar-roles`;
    const updated = await request(path, { token, body, key }); assert.equal(updated.status, 200, JSON.stringify(updated));
    assert.equal((await request(path, { token, body, key })).meta.repetido, true);
    assert.equal((await request(path, { token, body })).error.code, "VERSION_DESACTUALIZADA");
    assert.equal((await request(path, { token, body: { ...body, versionEsperada: "2", roles: [] } })).error.code, "ROL_REQUERIDO");
    assert.equal((await request(users, { token: employeeToken })).status, 200);
    assert.deepEqual((await request("/acceso/yo", { token: employeeToken })).data.roles, ["ADMINISTRADOR", "MECANICO"]);
    await request(path, { token, body: { ...body, versionEsperada: "2", roles: ["MECANICO"] } });
    assert.equal((await request(users, { token: employeeToken })).status, 403);
    const history = await owner.execute("select count(*) from usuario_rol where id_usuario=:id and retirado_en is not null", { id: employeeId });
    assert.equal(history.rows[0][0], 2);
  });
  await t.test("mobile client logs in over real HTTP, resolves Oracle roles and logs out", async () => {
    let saved = null;
    const mobile = createApiClient({ baseUrl: base, fetchImpl: fetch,
      store: { read: async () => saved, write: async (tokens) => { saved = tokens; }, clear: async () => { saved = null; } } });
    await mobile.login(createBody.login, password);
    const identity = await mobile.identity();
    assert.equal(identity.usuarioId, employeeId); assert.deepEqual(identity.roles, ["MECANICO"]);
    assert.deepEqual(getInternalDestinations(identity.roles).map((d) => d.key), ["home", "orders"]);
    assert.equal(JSON.stringify(saved).includes(password), false);
    await mobile.logout(); assert.equal(saved, null);
  });
  await t.test("audit failure rolls back status, versions, sessions, tokens and command", async () => {
    await owner.execute(`CREATE OR REPLACE TRIGGER test_users_audit BEFORE INSERT ON auditoria_evento
      FOR EACH ROW BEGIN IF :new.accion='I14' THEN RAISE_APPLICATION_ERROR(-20999,'TEST_FAILURE'); END IF; END;`);
    const before = (await request(`${users}/${employeeId}`, { token })).data;
    const key = randomUUID();
    const failed = await request(`${users}/${employeeId}/desactivar`, { token, key,
      body: { versionEsperada: before.version, motivo: "Prueba atómica" } });
    assert.equal(failed.status, 500);
    assert.deepEqual((await request(`${users}/${employeeId}`, { token })).data, before);
    assert.equal((await request("/acceso/yo", { token: employeeToken })).status, 200);
    assert.equal((await owner.execute("select count(*) from comando where clave_idempotencia=:key", { key })).rows[0][0], 0);
    await owner.execute("DROP TRIGGER test_users_audit");
  });
  await t.test("deactivation revokes existing access and refresh; no historical role deletion", async () => {
    const employeeLogin = await login(createBody.login);
    const before = (await request(`${users}/${employeeId}`, { token })).data;
    const key = randomUUID(); const path = `${users}/${employeeId}/desactivar`;
    const body = { versionEsperada: before.version, motivo: "Fin de relación laboral" };
    assert.equal((await request(path, { token, key, body })).status, 200);
    assert.equal((await request(path, { token, key, body })).meta.repetido, true);
    assert.equal((await request("/acceso/yo", { token: employeeToken })).status, 401);
    assert.equal((await request("/acceso/sesiones/renovar", { body: { refreshToken: employeeLogin.data.tokens.refreshToken } })).status, 401);
    const inactive = await login(createBody.login); const missing = await login("missing.test");
    assert.equal(inactive.status, 401); assert.equal(inactive.error.code, missing.error.code);
    assert.equal((await owner.execute("select count(*) from usuario_rol where id_usuario=:id", { id: employeeId })).rows[0][0], 3);
    assert.equal((await request(`${users}?activo=false`, { token })).data[0].id, employeeId);
  });
  await t.test("two independent sessions cannot remove both remaining administrators", async () => {
    const created = await request(users, { token, body: { ...createBody, login: "second.admin", roles: ["ADMINISTRADOR", "RECEPCIONISTA"] } });
    assert.equal(created.status, 201);
    const second = await login("second.admin");
    const pair = await Promise.all([[adminId, token], [created.data.usuarioId, second.data.tokens.accessToken]].map(
      ([id, actorToken]) => request(`${users}/${id}/cambiar-roles`, { token: actorToken,
        body: { versionEsperada: "1", roles: ["RECEPCIONISTA"], motivo: "Retiro concurrente" } })));
    assert.deepEqual(pair.map((r) => r.status).sort(), [200, 422]);
    assert.equal(pair.find((r) => r.status === 422).error.code, "ULTIMO_ADMINISTRADOR");
    const index = pair.findIndex((r) => r.status === 422);
    token = index === 0 ? token : second.data.tokens.accessToken;
    const remaining = index === 0 ? adminId : created.data.usuarioId;
    assert.equal((await request(`${users}/${remaining}/desactivar`, { token,
      body: { versionEsperada: "1", motivo: "Último" } })).error.code, "ULTIMO_ADMINISTRADOR");
  });
  await t.test("runtime has bounded grants; no credential reads, direct DML or unfinished commands", async () => {
    await poolManager.withConnection(async (connection) => {
      await assert.rejects(connection.execute(`SELECT credencial_hash FROM ${schema}.usuario`));
      await assert.rejects(connection.execute(`UPDATE ${schema}.usuario SET activo=0`));
      await assert.rejects(connection.execute(`BEGIN ${schema}.pkg_identidad_bootstrap.crear_usuario_interno('x','x','x','[]',:id); END;`,
        { id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } }));
    });
    assert.equal((await owner.execute("select count(*) from comando where resultado_codigo=102 or resultado_minimo is null")).rows[0][0], 0);
    const stored = await owner.execute("select dbms_lob.substr(resultado_minimo,4000) from comando");
    assert.equal(JSON.stringify(stored.rows).includes(password), false);
    assert.equal(JSON.stringify(logs).includes(password), false);
    assert.equal(JSON.stringify(logs).includes("$argon2"), false);
    assert.equal(JSON.stringify(logs).includes(token), false);
  });
});
