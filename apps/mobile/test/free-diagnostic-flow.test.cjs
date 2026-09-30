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
