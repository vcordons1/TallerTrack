import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createApp } from "../src/app.js";
import { createOpaqueCursorCodec } from "../src/platform/operational-query-contract.js";

const token = "header.payload.signature";
const key = "12345678-1234-4567-89ab-1234567890ab";

async function fixture(t) {
  let roles = ["RECEPCIONISTA"];
  const calls = [];
  const repository = {
    async read(kind, input) {
      calls.push([kind, input]);
      if (kind === "directory") return [{ id: "15", nombre: "Ana" }];
      if (kind === "participants") return [{ id: "9", mecanico: { id: "15", nombre: "Ana" },
        asignadoEn: "2026-09-29T00:00:00Z", retiradoEn: null, motivoRetiro: null }];
      return [];
    },
    async command(input) {
      calls.push([input.operation, input]);
      return { data: { participacionId: "9", mecanicoId: "15" }, repeated: false,
        commandId: "101", confirmedAt: "2026-09-29T00:00:00Z" };
    },
  };
  const app = createApp({ identityService: { authenticate: async () => ({
    userId: "7", sessionId: "8", type: "INTERNO", roles,
  }) }, freeDiagnosticRepository: repository,
  cursorCodec: createOpaqueCursorCodec({ hmacKey: Buffer.alloc(32, 4) }),
  logger: { error() {} } });
  const server = app.listen(0); await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  function request(path, method = "GET", body) {
    return fetch(`${base}${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json",
        "Idempotency-Key": key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  }
  return { request, calls, setRoles(next) { roles = next; } };
}

test("O05 and I15 expose participants and only eligible directory fields", async (t) => {
  const { request, calls } = await fixture(t);
  const directory = await request("/interno/mecanicos?ordenId=2");
  assert.equal(directory.status, 200);
  assert.deepEqual((await directory.json()).data, [{ id: "15", nombre: "Ana" }]);
  const participants = await request("/interno/ordenes/2/mecanicos?vigentes=true");
  assert.equal(participants.status, 200);
  assert.deepEqual((await participants.json()).data[0].mecanico, { id: "15", nombre: "Ana" });
  assert.equal(calls.at(-1)[1].active, true);
});

test("O06 derives actor from session and rejects caller controlled authority", async (t) => {
  const value = await fixture(t);
  const path = "/interno/ordenes/2/asignar-mecanico";
  const success = await value.request(path, "POST", { mecanicoId: "15", motivo: "Diagnóstico" });
  assert.equal(success.status, 201);
  assert.equal((await success.json()).data.participacionId, "9");
  assert.equal(value.calls.at(-1)[1].actorId, "7");
  assert.equal(value.calls.at(-1)[1].sessionId, "8");
  assert.equal(value.calls.at(-1)[1].idempotencyKey, key);
  for (const extra of [{ actorId: "99" }, { rol: "RECEPCIONISTA" }, { asignadoPor: "99" }]) {
    const response = await value.request(path, "POST", { mecanicoId: "15", motivo: "Diagnóstico", ...extra });
    assert.equal(response.status, 400);
  }
  value.setRoles(["ADMINISTRADOR"]);
  assert.equal((await value.request(path, "POST", { mecanicoId: "15", motivo: "Diagnóstico" })).status, 403);
  value.setRoles(["CLIENTE"]);
  assert.equal((await value.request(path, "POST", { mecanicoId: "15", motivo: "Diagnóstico" })).status, 403);
});

test("T02/T04/D02 accept only the free technical variant and no actor IDs", async (t) => {
  const value = await fixture(t);
  value.setRoles(["MECANICO"]);
  const workPath = "/interno/ordenes/2/trabajos";
  assert.equal((await value.request(workPath, "POST", { tipo: "DIAGNOSTICO",
    tipoServicio: "DIAGNOSTICO", descripcion: "Revisar falla", diagnosticoGratuito: true })).status, 201);
  assert.equal(value.calls.at(-1)[1].free, 1);
  for (const payload of [
    { tipo: "DIAGNOSTICO", tipoServicio: "DIAGNOSTICO", descripcion: "X", diagnosticoGratuito: false },
    { tipo: "REPARACION", tipoServicio: "DIAGNOSTICO", descripcion: "X", diagnosticoGratuito: true },
  ]) assert.equal((await value.request(workPath, "POST", payload)).status, 422);
  assert.equal((await value.request("/interno/ordenes/2/trabajos/4/iniciar", "POST",
    { versionEsperada: "1", motivo: "Iniciar", itemId: "10" })).status, 400);
  assert.equal((await value.request("/interno/ordenes/2/diagnosticos/confirmar", "POST",
    { trabajoDiagnosticoId: "4", detalleTecnico: "Hallazgo", resumenCliente: "Resumen", mecanicoId: "77" })).status, 400);
  assert.equal((await value.request("/interno/ordenes/2/diagnosticos/confirmar", "POST",
    { trabajoDiagnosticoId: "4", detalleTecnico: "Hallazgo", resumenCliente: "Resumen" })).status, 201);
  assert.equal(value.calls.at(-1)[1].actorId, "7");
  value.setRoles(["CLIENTE"]);
  assert.equal((await value.request("/interno/ordenes/2/trabajos")).status, 403);
});
