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

test("I15 requires ordenId and an operational role; A and I are refused before Oracle", async (t) => {
  const value = await fixture(t);
  assert.equal((await value.request("/interno/mecanicos")).status, 400);
  assert.equal((await value.request("/interno/mecanicos?ordenId=2&q=ana")).status, 200);
  assert.equal(value.calls.at(-1)[1].q, "ana");
  assert.equal(value.calls.at(-1)[1].actorId, "7");
  const before = value.calls.length;
  for (const roles of [["ADMINISTRADOR"], ["INVENTARIO"], ["CLIENTE"]]) {
    value.setRoles(roles);
    assert.equal((await value.request("/interno/mecanicos?ordenId=2")).status, 403);
  }
  value.setRoles(["INVENTARIO"]);
  assert.equal((await value.request("/interno/ordenes/2/mecanicos")).status, 403);
  assert.equal(value.calls.length, before);
});

test("O07 sends only the participation, reason and session-derived actor", async (t) => {
  const value = await fixture(t);
  const path = "/interno/ordenes/2/participaciones/9/retirar";
  assert.equal((await value.request(path, "POST", { motivo: "  Cambio de turno  " })).status, 200);
  const [operation, input] = value.calls.at(-1);
  assert.equal(operation, "RETIRAR_MECANICO");
  assert.deepEqual([input.orderId, input.resourceId, input.reason, input.actorId, input.sessionId],
    ["2", "9", "Cambio de turno", "7", "8"]);
  for (const body of [{ motivo: " " }, { motivo: "X", retiradoPor: "99" }, {}]) {
    assert.equal((await value.request(path, "POST", body)).status, 400);
  }
  value.setRoles(["ADMINISTRADOR"]);
  assert.equal((await value.request(path, "POST", { motivo: "X" })).status, 403);
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

test("TT-029: only MECANICO reaches T02/T04/D02 and the T04 reason respects Texto(1000)", async (t) => {
  const value = await fixture(t);
  const commands = [
    ["/interno/ordenes/2/trabajos", { tipo: "DIAGNOSTICO", tipoServicio: "DIAGNOSTICO",
      descripcion: "Revisar falla", diagnosticoGratuito: true }],
    ["/interno/ordenes/2/trabajos/4/iniciar", { versionEsperada: "1", motivo: "Iniciar" }],
    ["/interno/ordenes/2/diagnosticos/confirmar", { trabajoDiagnosticoId: "4", detalleTecnico: "Hallazgo",
      resumenCliente: "Resumen" }],
  ];
  for (const roles of [["ADMINISTRADOR"], ["RECEPCIONISTA"], ["INVENTARIO"]]) {
    value.setRoles(roles);
    for (const [path, payload] of commands) {
      const response = await value.request(path, "POST", payload);
      assert.equal(response.status, 403, `${roles} ${path}`);
      assert.equal((await response.json()).error.code, "ACCION_NO_PERMITIDA");
    }
  }
  const before = value.calls.length;
  value.setRoles(["ADMINISTRADOR"]);
  assert.equal((await value.request("/interno/ordenes/2/trabajos")).status, 200);
  value.setRoles(["RECEPCIONISTA"]);
  assert.equal((await value.request("/interno/ordenes/2/diagnosticos")).status, 200);
  assert.equal(value.calls.slice(before).every(([kind]) => kind === "works" || kind === "diagnoses"), true,
    "refused commands never reach Oracle");
  value.setRoles(["MECANICO"]);
  const start = "/interno/ordenes/2/trabajos/4/iniciar";
  for (const motivo of ["", "   ", "x".repeat(1001)]) {
    assert.equal((await value.request(start, "POST", { versionEsperada: "1", motivo })).status, 400);
  }
  assert.equal((await value.request(start, "POST", { versionEsperada: "1", motivo: "x".repeat(1000) })).status, 200);
  assert.equal(value.calls.at(-1)[1].reason, "x".repeat(1000));
  assert.equal((await value.request(start, "POST", { versionEsperada: "1" })).status, 400);
});
