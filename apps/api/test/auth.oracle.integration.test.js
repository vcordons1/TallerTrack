import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import oracledb from "oracledb";

import { requireAnyRole } from "../src/modules/identity/identity-service.js";
import { startServer } from "../src/server.js";

const enabled = process.env.TT_RUN_AUTH_ORACLE_INTEGRATION === "1";

async function request(baseUrl, route, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${route}`, {
    method: body === undefined ? "GET" : "POST", headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { response, body: text === "" ? null : JSON.parse(text) };
}

function roleOutcome(context, role) {
  let outcome = "passed";
  requireAnyRole(role)({ auth: context }, {}, (error) => { outcome = error?.code ?? "passed"; });
  return outcome;
}

test("I01-I04 use real Oracle sessions, live roles, rotation, reuse defense and logout",
  { skip: !enabled, timeout: 120_000 }, async (t) => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "tallertrack-auth-"));
    t.after(() => rm(storageRoot, { recursive: true, force: true }));
    const environment = {
      ...process.env,
      TT_PRIVATE_STORAGE_ROOT: storageRoot,
      TT_EVIDENCE_MAX_FILE_BYTES: "10485760", TT_EVIDENCE_MAX_PIXELS: "25000000",
      TT_EVIDENCE_MAX_DIMENSION: "8192", TT_EVIDENCE_MAX_FILES_PER_OPERATION: "10",
      TT_UPLOAD_RECEIPT_HMAC_KEY_BASE64: Buffer.alloc(32, 0x51).toString("base64"),
      TT_UPLOAD_RECEIPT_TTL_SECONDS: "900",
      TT_AUTH_SIGNING_KEY_BASE64: Buffer.alloc(32, 0x52).toString("base64"),
      TT_AUTH_ISSUER: "tallertrack-auth-test", TT_AUTH_AUDIENCE: "tallertrack-api-test",
      TT_AUTH_ACCESS_TTL_SECONDS: "600", TT_AUTH_SESSION_TTL_SECONDS: "43200",
      TT_AUTH_REFRESH_TTL_SECONDS: "43200", TT_AUTH_LOGIN_MAX_ATTEMPTS: "5",
      TT_AUTH_LOGIN_WINDOW_SECONDS: "900",
    };
    const runtime = await startServer({ environment, logger: { log() {}, error() {} }, port: 0 });
    t.after(() => runtime.shutdown("TEST"));
    const baseUrl = `http://127.0.0.1:${runtime.server.address().port}/api/v1`;
    const owner = await oracledb.getConnection({
      user: process.env.TT_AUTH_TEST_OWNER,
      password: process.env.TT_AUTH_TEST_OWNER_PASSWORD,
      connectString: process.env.TT_ORACLE_CONNECT_STRING,
    });
    t.after(() => owner.close());

    const invalidPassword = await request(baseUrl, "/acceso/sesiones", {
      body: { login: process.env.TT_AUTH_TEST_LOGIN, password: "incorrect-password" },
    });
    const invalidLogin = await request(baseUrl, "/acceso/sesiones", {
      body: { login: "does.not.exist", password: "incorrect-password" },
    });
    assert.equal(invalidPassword.response.status, 401);
    assert.equal(invalidLogin.response.status, 401);
    assert.equal(invalidPassword.body.error.code, "CREDENCIALES_INVALIDAS");
    assert.equal(invalidLogin.body.error.code, "CREDENCIALES_INVALIDAS");
    assert.deepEqual(
      { message: invalidPassword.body.error.message, fields: invalidPassword.body.error.fields, details: invalidPassword.body.error.details },
      { message: invalidLogin.body.error.message, fields: invalidLogin.body.error.fields, details: invalidLogin.body.error.details },
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const limited = await request(baseUrl, "/acceso/sesiones", {
        body: { login: "rate.limit.target", password: "incorrect-password" },
      });
      assert.equal(limited.response.status, 401);
    }
    const limited = await request(baseUrl, "/acceso/sesiones", {
      body: { login: "rate.limit.target", password: "incorrect-password" },
    });
    assert.equal(limited.response.status, 429);
    assert.ok(Number(limited.response.headers.get("retry-after")) > 0);
    const unknown = await request(baseUrl, "/acceso/sesiones", {
      body: { login: process.env.TT_AUTH_TEST_LOGIN, password: process.env.TT_AUTH_TEST_PASSWORD, admin: true },
    });
    assert.equal(unknown.response.status, 400);
    const duplicate = await fetch(`${baseUrl}/acceso/sesiones`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: `{"login":"${process.env.TT_AUTH_TEST_LOGIN}","login":"other","password":"x"}`,
    });
    assert.equal(duplicate.status, 400);

    async function login(expectedRoles = ["RECEPCIONISTA"]) {
      const result = await request(baseUrl, "/acceso/sesiones", {
        body: { login: process.env.TT_AUTH_TEST_LOGIN, password: process.env.TT_AUTH_TEST_PASSWORD, dispositivo: "oracle-test" },
      });
      assert.equal(result.response.status, 201);
      assert.equal(result.response.headers.get("cache-control"), "no-store");
      assert.deepEqual(Object.keys(result.body.data).sort(), ["acceso", "tokens"]);
      assert.deepEqual(result.body.data.acceso.roles, expectedRoles);
      assert.equal(result.body.data.acceso.tipoActor, "INTERNO");
      assert.equal(result.body.data.acceso.clienteId, null);
      return result.body.data;
    }

    const first = await login();
    const me = await request(baseUrl, "/acceso/yo", { token: first.tokens.accessToken });
    assert.equal(me.response.status, 200);
    assert.deepEqual(me.body.data, first.acceso);
    const tampered = `${first.tokens.accessToken.slice(0, -1)}x`;
    const tamperedResponse = await request(baseUrl, "/acceso/yo", { token: tampered });
    assert.equal(tamperedResponse.response.status, 401);
    assert.equal(JSON.stringify(tamperedResponse.body).includes(tampered), false);
    const wrongScheme = await fetch(`${baseUrl}/acceso/yo`, { headers: { Authorization: "Basic opaque" } });
    assert.equal(wrongScheme.status, 401);

    const contextBefore = await runtime.identityService.authenticate(first.tokens.accessToken);
    assert.equal(roleOutcome(contextBefore, "RECEPCIONISTA"), "passed");
    await owner.execute(`INSERT INTO usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por)
      VALUES(:id,'ADMINISTRADOR',SYSTIMESTAMP,:id)`, { id: first.acceso.usuarioId });
    await owner.execute(`UPDATE usuario_rol SET retirado_en=SYSTIMESTAMP, retirado_por=id_usuario,
      motivo_retiro='Prueba retiro vigente' WHERE id_usuario=:id AND codigo_rol='RECEPCIONISTA' AND retirado_en IS NULL`,
    { id: first.acceso.usuarioId });
    await owner.commit();
    const withoutRole = await runtime.identityService.authenticate(first.tokens.accessToken);
    assert.deepEqual(withoutRole.roles, ["ADMINISTRADOR"]);
    assert.equal(roleOutcome(withoutRole, "RECEPCIONISTA"), "ACCION_NO_PERMITIDA");
    await owner.execute(`UPDATE usuario_rol SET retirado_en=SYSTIMESTAMP, retirado_por=id_usuario,
      motivo_retiro='Prueba sin roles' WHERE id_usuario=:id AND codigo_rol='ADMINISTRADOR' AND retirado_en IS NULL`,
    { id: first.acceso.usuarioId });
    await owner.commit();
    assert.equal((await request(baseUrl, "/acceso/yo", { token: first.tokens.accessToken })).response.status, 401);
    await owner.execute(`INSERT INTO usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por)
      VALUES(:id,'ADMINISTRADOR',SYSTIMESTAMP,:id)`, { id: first.acceso.usuarioId });
    await owner.execute(`INSERT INTO usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por)
      VALUES(:id,'RECEPCIONISTA',SYSTIMESTAMP,:id)`, { id: first.acceso.usuarioId });
    await owner.commit();
    const restoredRole = await runtime.identityService.authenticate(first.tokens.accessToken);
    assert.equal(roleOutcome(restoredRole, "RECEPCIONISTA"), "passed");

    const rotated = await request(baseUrl, "/acceso/sesiones/renovar", {
      body: { refreshToken: first.tokens.refreshToken },
    });
    assert.equal(rotated.response.status, 200);
    assert.notEqual(rotated.body.data.refreshToken, first.tokens.refreshToken);
    const reused = await request(baseUrl, "/acceso/sesiones/renovar", {
      body: { refreshToken: first.tokens.refreshToken },
    });
    assert.equal(reused.response.status, 401);
    assert.equal(reused.body.error.code, "RENOVACION_INVALIDA");
    assert.equal((await request(baseUrl, "/acceso/sesiones/renovar", {
      body: { refreshToken: rotated.body.data.refreshToken },
    })).response.status, 401);
    assert.equal((await request(baseUrl, "/acceso/yo", { token: rotated.body.data.accessToken })).response.status, 401);

    const racing = await login(["ADMINISTRADOR", "RECEPCIONISTA"]);
    const race = await Promise.all([1, 2].map(() => request(baseUrl, "/acceso/sesiones/renovar", {
      body: { refreshToken: racing.tokens.refreshToken },
    })));
    assert.deepEqual(race.map((entry) => entry.response.status).sort(), [200, 401]);
    const raceWinner = race.find((entry) => entry.response.status === 200);
    assert.equal((await request(baseUrl, "/acceso/sesiones/renovar", {
      body: { refreshToken: raceWinner.body.data.refreshToken },
    })).response.status, 401);

    const logoutSession = await login(["ADMINISTRADOR", "RECEPCIONISTA"]);
    const logout = await request(baseUrl, "/acceso/sesiones/cerrar", {
      token: logoutSession.tokens.accessToken, body: {},
    });
    assert.equal(logout.response.status, 204);
    assert.equal((await request(baseUrl, "/acceso/yo", { token: logoutSession.tokens.accessToken })).response.status, 401);
    assert.equal((await request(baseUrl, "/acceso/sesiones/renovar", {
      body: { refreshToken: logoutSession.tokens.refreshToken },
    })).response.status, 401);

    const persisted = await owner.execute(`SELECT u.credencial_hash, t.token_hash
      FROM usuario u JOIN sesion s ON s.id_usuario=u.id_usuario
      JOIN token_acceso t ON t.id_sesion=s.id_sesion
      WHERE u.id_usuario=:id FETCH FIRST 1 ROW ONLY`, { id: first.acceso.usuarioId });
    assert.equal(persisted.rows[0][0].includes(process.env.TT_AUTH_TEST_PASSWORD), false);
    assert.equal(Buffer.isBuffer(persisted.rows[0][1]), true);
    assert.equal(persisted.rows[0][1].length, 32);

    const versioned = await login(["ADMINISTRADOR", "RECEPCIONISTA"]);
    await owner.execute("UPDATE usuario SET version_credencial=version_credencial+1 WHERE id_usuario=:id", { id: versioned.acceso.usuarioId });
    await owner.commit();
    assert.equal((await request(baseUrl, "/acceso/yo", { token: versioned.tokens.accessToken })).response.status, 401);
    const active = await login(["ADMINISTRADOR", "RECEPCIONISTA"]);
    await owner.execute("UPDATE usuario SET activo=0 WHERE id_usuario=:id", { id: active.acceso.usuarioId });
    await owner.commit();
    assert.equal((await request(baseUrl, "/acceso/yo", { token: active.tokens.accessToken })).response.status, 401);
    const audit = await owner.execute(`SELECT accion, COUNT(*) FROM auditoria_evento
      WHERE id_actor=:id AND accion IN ('REVOCAR_POR_REUSO_REFRESH','CERRAR_SESION')
      GROUP BY accion`, { id: active.acceso.usuarioId });
    const auditCounts = Object.fromEntries(audit.rows);
    assert.ok(auditCounts.REVOCAR_POR_REUSO_REFRESH >= 2);
    assert.ok(auditCounts.CERRAR_SESION >= 1);
  });
