const test = require("node:test");
const assert = require("node:assert/strict");

const { createReceptionFlow } = require("../src/features/reception/receptionFlow.cjs");

const vehicle = { id: "7", activo: true, ordenActivaId: null,
  propiedadActual: { id: "9", clienteId: "5" } };
const input = { customerId: "5", vehicleId: "7", kilometrajeIngreso: "321.0",
  motivoIngreso: "Ruido", danosVisibles: "Sin daños visibles", photo: { uri: "file:///photo.jpg" } };

test("uncertain O02 keeps the exact body and idempotency key, then confirms through O03", async () => {
  const calls = [];
  let opens = 0;
  const flow = createReceptionFlow({ uuid: () => "fixed-uuid", repository: {
    async getVehicle() { calls.push("V03"); return vehicle; },
    async upload() { calls.push("E01"); return "receipt"; },
    async open(body, key) {
      calls.push(["O02", body, key]);
      if (++opens === 1) throw Object.assign(new Error("timeout"), { uncertain: true });
      return { ordenId: "10" };
    },
    async getOrder(id) { calls.push(["O03", id]); return { id }; },
  } });
  await assert.rejects(() => flow.submit(input), /timeout/);
  assert.equal(flow.hasPending, true);
  assert.deepEqual(await flow.submit(input), { id: "10" });
  assert.deepEqual(calls.map((call) => typeof call === "string" ? call : call[0]),
    ["V03", "E01", "O02", "O02", "O03"]);
  assert.strictEqual(calls[2][1], calls[3][1]);
  assert.equal(calls[2][2], calls[3][2]);
  assert.equal(flow.hasPending, false);
});

test("changed property prevents E01 and O02", async () => {
  let uploaded = false;
  const flow = createReceptionFlow({ uuid: () => "key", repository: {
    async getVehicle() { return { ...vehicle, propiedadActual: { id: "11", clienteId: "6" } }; },
    async upload() { uploaded = true; },
  } });
  await assert.rejects(() => flow.submit(input), /propiedad/);
  assert.equal(uploaded, false);
});

test("success is withheld when O03 does not confirm the order", async () => {
  const flow = createReceptionFlow({ uuid: () => "key", repository: {
    async getVehicle() { return vehicle; }, async upload() { return "receipt"; },
    async open() { return { ordenId: "10" }; },
    async getOrder() { throw new Error("offline"); },
  } });
  await assert.rejects(() => flow.submit(input), /offline/);
  assert.equal(flow.hasPending, true);
});

test("failed evidence upload never opens an order", async () => {
  let opened = false;
  const flow = createReceptionFlow({ uuid: () => "key", repository: {
    async getVehicle() { return vehicle; },
    async upload() { throw new Error("upload failed"); },
    async open() { opened = true; },
  } });
  await assert.rejects(() => flow.submit(input), /upload failed/);
  assert.equal(opened, false);
  assert.equal(flow.hasPending, false);
});

test("two simultaneous submits create one server order with verified context", async () => {
  let finishUpload;
  const uploadWait = new Promise((resolve) => { finishUpload = resolve; });
  const calls = [];
  const flow = createReceptionFlow({ uuid: () => "unique-key", repository: {
    async getVehicle() { calls.push("V03"); return vehicle; },
    async upload(_photo, context) { calls.push(["E01", context]); await uploadWait; return "receipt"; },
    async open(body, key) { calls.push(["O02", body, key]); return { ordenId: "10" }; },
    async getOrder(id) { calls.push(["O03", id]); return { id }; },
  } });
  const first = flow.submit(input);
  const second = flow.submit(input);
  assert.equal(await second, null);
  finishUpload();
  assert.deepEqual(await first, { id: "10" });
  assert.deepEqual(calls.map((call) => typeof call === "string" ? call : call[0]), ["V03", "E01", "O02", "O03"]);
  assert.deepEqual(calls[1][1], { vehiculoId: "7", propiedadEsperadaId: "9", propietarioEsperadoId: "5" });
  assert.equal(calls[2][1].evidenciasRecepcion[0].recibo, "receipt");
  assert.equal(calls[2][2], "unique-key");
});
