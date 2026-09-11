import assert from "node:assert/strict";
import test from "node:test";

import { createIdentityService, requireAnyRole } from "../src/modules/identity/identity-service.js";
import { createLoginRateLimit } from "../src/modules/identity/login-rate-limit.js";

const authConfig = {
  sessionTtlSeconds: 43_200, refreshTtlSeconds: 43_200,
  loginMaximumAttempts: 5, loginWindowSeconds: 900, loginBucketCapacity: 100,
  hashMaximumConcurrency: 4,
};

function harness({ credential = null, access = null, rotation = { outcome: "INVALIDA" } } = {}) {
  const calls = [];
  const repository = {
    async findInternalCredential(login) { calls.push(["find", login]); return credential; },
    async createSession(input) { calls.push(["create", input]); return access; },
    async validateSession(input) { calls.push(["validate", input]); return access; },
    async rotateRefresh(input) { calls.push(["rotate", input]); return rotation; },
    async revokeSession(input) { calls.push(["revoke", input]); return true; },
  };
  const passwordService = {
    async hash() { return "dummy-hash"; },
    async verify(hash, password) { calls.push(["verify", hash, password]); return hash === "real-hash" && password === "correct"; },
  };
  const tokenService = {
    createSessionIdentifier: () => "a".repeat(32),
    createRefreshToken: () => "r".repeat(43),
    hashRefreshToken: (value) => Buffer.from(value.slice(0, 32)),
    async issueAccessToken() { return { accessToken: "signed", accessExpiresAt: new Date("2026-09-11T12:10:00Z") }; },
    async verifyAccessToken() { return { userId: "9", sessionIdentifier: "a".repeat(32), credentialVersion: "1" }; },
  };
  return { calls, create: () => createIdentityService({
    repository, passwordService, tokenService, authConfig,
    clock: () => new Date("2026-09-11T12:00:00Z"),
  }) };
}

test("login creates a real session and returns canonical tokens plus current access", async () => {
  const access = { userId: "9", sessionId: "20", type: "INTERNO", clientId: null,
    displayName: "Recepción", roles: ["RECEPCIONISTA"], sessionExpiresAt: "2026-09-12T00:00:00.000000Z" };
  const { calls, create } = harness({
    credential: { userId: "9", passwordHash: "real-hash", credentialVersion: "1", active: 1 }, access,
  });
  const service = await create();
  const result = await service.login({ login: " Recep.Local ", password: "correct" }, "127.0.0.1");
  assert.equal(result.tokens.tokenType, "Bearer");
  assert.equal(result.tokens.refreshToken, "r".repeat(43));
  assert.deepEqual(result.acceso, {
    usuarioId: "9", tipoActor: "INTERNO", nombreMostrado: "Recepción",
    roles: ["RECEPCIONISTA"], clienteId: null, sesionExpiraEn: "2026-09-12T00:00:00.000000Z",
  });
  assert.deepEqual(calls.slice(0, 2).map((call) => call[0]), ["find", "verify"]);
  assert.equal(calls.find(([name]) => name === "create")[1].device, null);
});

test("unknown login still performs dummy Argon2 verification and returns the uniform code", async () => {
  const { calls, create } = harness();
  const service = await create();
  await assert.rejects(service.login({ login: "missing", password: "wrong" }, "ip"), { code: "CREDENCIALES_INVALIDAS" });
  assert.deepEqual(calls.map((call) => call[0]), ["find", "verify"]);
  assert.equal(calls[1][1], "dummy-hash");
});

test("persistent session state is required even when JWT verification succeeds", async () => {
  const { create } = harness({ access: null });
  const service = await create();
  await assert.rejects(service.authenticate("signed"), { code: "SESION_INVALIDA" });
});

test("role authorization has no ADMINISTRADOR inheritance", () => {
  const middleware = requireAnyRole("RECEPCIONISTA");
  function outcome(roles) {
    let result = "passed";
    middleware({ auth: { type: "INTERNO", roles } }, {}, (error) => { result = error?.code ?? "passed"; });
    return result;
  }
  assert.equal(outcome(["RECEPCIONISTA"]), "passed");
  assert.equal(outcome(["ADMINISTRADOR"]), "ACCION_NO_PERMITIDA");
  assert.equal(outcome(["ADMINISTRADOR", "RECEPCIONISTA"]), "passed");
});

test("login abuse control is bounded, uniform by origin+login and supplies retry timing", () => {
  let now = 0;
  const limit = createLoginRateLimit({ maximumAttempts: 2, windowSeconds: 10, capacity: 100, clock: () => now });
  assert.equal(limit.consume("ip", "login").allowed, true);
  assert.equal(limit.consume("ip", "login").allowed, true);
  assert.deepEqual(limit.consume("ip", "login"), { allowed: false, retryAfterSeconds: 10 });
  assert.equal(limit.consume("other-ip", "login").allowed, true);
  now = 10_001;
  assert.equal(limit.consume("ip", "login").allowed, true);
});

test("Argon2 verification concurrency is bounded without queueing password material", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const service = await createIdentityService({
    repository: {
      async findInternalCredential() {
        return { userId: "1", passwordHash: "hash", credentialVersion: "1", active: 1 };
      },
    },
    passwordService: {
      async hash() { return "dummy"; },
      async verify() { await blocked; return false; },
    },
    tokenService: {},
    authConfig: { ...authConfig, hashMaximumConcurrency: 1 },
  });
  const first = service.login({ login: "one", password: "secret" }, "ip-one");
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(service.login({ login: "two", password: "secret" }, "ip-two"), {
    code: "DEMASIADAS_SOLICITUDES",
  });
  release();
  await assert.rejects(first, { code: "CREDENCIALES_INVALIDAS" });
});
