const assert = require("node:assert/strict");
const test = require("node:test");

const { createFreeDiagnosticFlow } = require("../src/features/orders/freeDiagnosticFlow.cjs");

test("uncertain diagnostic command retries identical action and key", async () => {
  let attempts = 0;
  let generated = 0;
  const calls = [];
  const flow = createFreeDiagnosticFlow({ uuid: () => `key-${++generated}` });
  const body = { trabajoDiagnosticoId: "4", detalleTecnico: "Sensor", resumenCliente: "Revisar sensor" };
  const action = async (key) => {
    calls.push({ key, body });
    if (++attempts === 1) throw Object.assign(new Error("Lost response"), { uncertain: true });
    return { diagnosticoId: "8" };
  };
  await assert.rejects(flow.run("confirm", action), { uncertain: true });
  assert.equal(flow.pending.kind, "confirm");
  await assert.rejects(flow.run("start", async () => {}), /Verifica primero/);
  assert.deepEqual(await flow.run("confirm", async () => { throw new Error("must not replace pending action"); }),
    { diagnosticoId: "8" });
  assert.deepEqual(calls, [{ key: "key-1", body }, { key: "key-1", body }]);
  assert.equal(generated, 1);
  assert.equal(flow.pending, null);
});

test("confirmed rejection clears pending intent", async () => {
  let generated = 0;
  const flow = createFreeDiagnosticFlow({ uuid: () => `key-${++generated}` });
  await assert.rejects(flow.run("assign", async () => { throw Object.assign(new Error("duplicate"), { uncertain: false }); }));
  assert.equal(flow.pending, null);
  assert.equal(await flow.run("assign", async (key) => key), "key-2");
});

const { freeDiagnosticActions, freeDiagnosticMessage, needsReload } =
  require("../src/features/orders/freeDiagnosticPresentation.cjs");

test("TT-029 error messages are readable Spanish with the server code; uncertain is never a failure", () => {
  const cases = [
    [{ status: 409, code: "ESTADO_INCOMPATIBLE" }, "start", /quizá ya se inició.*\(ESTADO_INCOMPATIBLE\)/],
    [{ status: 409, code: "ESTADO_INCOMPATIBLE" }, "confirm", /debe estar iniciado.*\(ESTADO_INCOMPATIBLE\)/],
    [{ status: 409, code: "VERSION_DESACTUALIZADA" }, "start", /Otra persona cambió.*\(VERSION_DESACTUALIZADA\)/],
    [{ status: 422, code: "ALCANCE_NO_AUTORIZADO" }, "propose", /diagnóstico gratuito explícito.*\(ALCANCE_NO_AUTORIZADO\)/],
    [{ status: 403, code: "ACCION_NO_PERMITIDA" }, "confirm", /sigues asignado.*\(ACCION_NO_PERMITIDA\)/],
    [{ status: 0 }, "propose", /No hay conexión/],
    [{ status: 500, code: "ERROR_INTERNO" }, "propose", /\(ERROR_INTERNO\)/],
  ];
  for (const [error, kind, expected] of cases) assert.match(freeDiagnosticMessage(error, kind), expected);
  const unknown = freeDiagnosticMessage({ status: 0, uncertain: true }, "confirm");
  assert.match(unknown, /Resultado desconocido: el informe pudo haberse registrado/);
  assert.equal(needsReload({ code: "VERSION_DESACTUALIZADA" }), true);
  assert.equal(needsReload({ code: "ESTADO_INCOMPATIBLE", uncertain: true }), false);
  assert.equal(needsReload({ code: "ALCANCE_NO_AUTORIZADO" }), false);
});

test("TT-029 actions follow the order state and the existing free diagnosis", () => {
  const order = { proposito: "COMERCIAL", estado: "RECIBIDO" };
  const work = (estado, extra = {}) => ({ id: "30", tipo: "DIAGNOSTICO", diagnosticoGratuito: true, estado, ...extra });
  assert.deepEqual(freeDiagnosticActions({ order, works: [], diagnoses: [] }), { canPropose: true, toStart: null, toConfirm: null });
  const proposed = freeDiagnosticActions({ order, works: [work("PROPUESTO")], diagnoses: [] });
  assert.equal(proposed.canPropose, false);
  assert.equal(proposed.toStart.id, "30");
  const running = { ...order, estado: "EN_DIAGNOSTICO" };
  assert.equal(freeDiagnosticActions({ order: running, works: [work("EN_EJECUCION")], diagnoses: [] }).toConfirm.id, "30");
  assert.equal(freeDiagnosticActions({ order: running, works: [work("EN_EJECUCION")],
    diagnoses: [{ trabajoDiagnosticoId: "30" }] }).toConfirm, null);
  assert.equal(freeDiagnosticActions({ order: { ...order, proposito: "GARANTIA" }, works: [], diagnoses: [] }).canPropose, false);
  assert.equal(freeDiagnosticActions({ order: { ...order, estado: "ENTREGADO" }, works: [work("PROPUESTO")], diagnoses: [] }).toStart, null);
  // A chargeable diagnosis is never offered for the free path.
  assert.equal(freeDiagnosticActions({ order, works: [work("PROPUESTO", { diagnosticoGratuito: false })], diagnoses: [] }).toStart, null);
});
