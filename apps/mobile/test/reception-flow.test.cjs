const test = require("node:test");
const assert = require("node:assert/strict");

const { NO_DAMAGE_TEXT, createReceptionFlow } = require("../src/features/reception/receptionFlow.cjs");
const { receptionMessage } = require("../src/features/reception/receptionMessage.cjs");

const NOW = Date.parse("2026-10-02T15:00:00.000Z");
const vehicle = { id: "7", activo: true, ordenActivaId: null,
  propiedadActual: { id: "9", clienteId: "5" } };
const evidence = { customerId: "5", vehicleId: "7", photo: { uri: "file:///photo.jpg" } };
const form = { customerId: "5", vehicleId: "7", kilometrajeIngreso: "321.0",
  motivoIngreso: "Ruido", danosVisibles: NO_DAMAGE_TEXT };
const upload = (recibo = "receipt", expiraEn = "2026-10-02T15:15:00.000Z") => ({ recibo, expiraEn });

function repository(overrides = {}) {
  const calls = [];
  return {
    calls,
    async getVehicle() { calls.push("V03"); return vehicle; },
    async upload(_photo, context) { calls.push(["E01", context]); return upload(); },
    async open(body, key) { calls.push(["O02", body, key]); return { ordenId: "10" }; },
    async getOrder(id) { calls.push(["O03", id]); return { id }; },
    ...overrides,
  };
}

const names = (calls) => calls.map((call) => typeof call === "string" ? call : call[0]);

test("preparing evidence (E01) never opens an order; confirming (O02) is a separate step", async () => {
  const repo = repository();
  const flow = createReceptionFlow({ uuid: () => "key", repository: repo, now: () => NOW });
  const prepared = await flow.prepare(evidence);
  assert.equal(flow.phase, "PREPARADA");
  assert.deepEqual(prepared.context, { vehiculoId: "7", propiedadEsperadaId: "9", propietarioEsperadoId: "5" });
  assert.deepEqual(names(repo.calls), ["V03", "E01"]);
  assert.deepEqual(await flow.submit(form), { id: "10" });
  assert.deepEqual(names(repo.calls), ["V03", "E01", "V03", "O02", "O03"]);
  const [, body, key] = repo.calls[3];
  assert.equal(key, "key");
  assert.deepEqual(body, { vehiculoId: "7", propiedadEsperadaId: "9", propietarioEsperadoId: "5",
    kilometrajeIngreso: "321.0", motivoIngreso: "Ruido", danosVisibles: "Sin daños visibles",
    evidenciasRecepcion: [{ recibo: "receipt", descripcion: "Fotografía de recepción" }] });
  assert.equal(flow.prepared, null);
  assert.equal(flow.phase, "EDITANDO");
});

test("confirming without prepared evidence is refused locally", async () => {
  const repo = repository();
  const flow = createReceptionFlow({ uuid: () => "key", repository: repo, now: () => NOW });
  await assert.rejects(() => flow.submit(form), { code: "EVIDENCIA_REQUERIDA" });
  assert.deepEqual(repo.calls, []);
});

test("an expired receipt is never sent: the evidence must be prepared again", async () => {
  let current = NOW;
  const repo = repository();
  const flow = createReceptionFlow({ uuid: () => "key", repository: repo, now: () => current });
  await flow.prepare(evidence);
  current = Date.parse("2026-10-02T15:15:00.000Z");
  await assert.rejects(() => flow.submit(form), (error) => error.code === "RECIBO_VENCIDO"
    && receptionMessage(error) === "La evidencia preparada venció. Prepárala de nuevo.");
  assert.equal(flow.prepared, null);
  assert.equal(names(repo.calls).includes("O02"), false);
});

test("uncertain O02 keeps the exact body and key; retry resolves the same intention through O03", async () => {
  let opens = 0;
  const repo = repository({
    async open(body, key) {
      repo.calls.push(["O02", body, key]);
      if (++opens === 1) throw Object.assign(new Error("timeout"), { uncertain: true });
      return { ordenId: "10" };
    },
  });
  let keys = 0;
  const flow = createReceptionFlow({ uuid: () => `key-${++keys}`, repository: repo, now: () => NOW });
  await flow.prepare(evidence);
  await assert.rejects(() => flow.submit(form), /timeout/);
  assert.equal(flow.hasPending, true);
  assert.equal(flow.phase, "INCIERTO");
  assert.match(receptionMessage({ uncertain: true }), /desconocido/);
  // A second preparation is impossible while the intention is unresolved.
  assert.equal(await flow.prepare(evidence), null);
  assert.deepEqual(await flow.submit({ ...form, motivoIngreso: "Editado después" }), { id: "10" });
  const opensSent = repo.calls.filter((call) => call[0] === "O02");
  assert.equal(opensSent.length, 2);
  assert.strictEqual(opensSent[0][1], opensSent[1][1]);
  assert.equal(opensSent[0][2], "key-1");
  assert.equal(opensSent[1][2], "key-1");
  assert.equal(keys, 1);
  assert.equal(flow.hasPending, false);
});

test("success is withheld while O03 cannot verify the order", async () => {
  const repo = repository({ async getOrder() { throw new Error("offline"); } });
  const flow = createReceptionFlow({ uuid: () => "key", repository: repo, now: () => NOW });
  await flow.prepare(evidence);
  await assert.rejects(() => flow.submit(form), /offline/);
  assert.equal(flow.hasPending, true);
  assert.equal(flow.phase, "INCIERTO");
});

test("changed property blocks E01, and a change after E01 blocks O02 without adopting the new owner", async () => {
  const before = repository({ async getVehicle() { return { ...vehicle, propiedadActual: { id: "11", clienteId: "6" } }; } });
  const blocked = createReceptionFlow({ uuid: () => "key", repository: before, now: () => NOW });
  await assert.rejects(() => blocked.prepare(evidence), { code: "PROPIEDAD_CAMBIADA" });
  assert.equal(names(before.calls).includes("E01"), false);

  let reads = 0;
  const after = repository({
    async getVehicle() {
      reads += 1;
      return reads === 1 ? vehicle : { ...vehicle, propiedadActual: { id: "12", clienteId: "5" } };
    },
  });
  const flow = createReceptionFlow({ uuid: () => "key", repository: after, now: () => NOW });
  await flow.prepare(evidence);
  await assert.rejects(() => flow.submit(form), { code: "PROPIEDAD_CAMBIADA" });
  assert.equal(flow.prepared, null);
  assert.equal(names(after.calls).includes("O02"), false);
});

test("server rejections end the intention and say what to do next", async () => {
  for (const [code, keepsEvidence, expected] of [
    ["ORDEN_ACTIVA_EXISTENTE", true, "Este vehículo ya tiene una atención activa."],
    ["DEUDA_NO_VERIFICABLE", true, "No se puede abrir la recepción. Se requiere revisión administrativa."],
    ["PROPIEDAD_CAMBIADA", false, "La propiedad del vehículo cambió. Vuelve a seleccionar el vehículo."],
    ["EVIDENCIA_NO_APLICABLE", false, "La fotografía preparada ya no es válida o venció. Prepárala de nuevo."],
  ]) {
    const repo = repository({
      async open() { throw Object.assign(new Error(code), { code, status: 409, uncertain: false, details: {} }); },
    });
    const flow = createReceptionFlow({ uuid: () => "key", repository: repo, now: () => NOW });
    await flow.prepare(evidence);
    await assert.rejects(() => flow.submit(form), (error) => receptionMessage(error) === expected);
    assert.equal(flow.hasPending, false, code);
    assert.equal(flow.prepared !== null, keepsEvidence, code);
  }
});

test("failed evidence upload prepares nothing", async () => {
  const repo = repository({ async upload() { throw new Error("upload failed"); } });
  const flow = createReceptionFlow({ uuid: () => "key", repository: repo, now: () => NOW });
  await assert.rejects(() => flow.prepare(evidence), (error) =>
    error.receptionStep === "E01"
      && receptionMessage(error) === "No se pudo cargar la fotografía. Comprueba la conexión y vuelve a intentar.");
  assert.equal(flow.prepared, null);
  assert.equal(flow.phase, "EDITANDO");
});

test("a confirmed rejection lets a new, separate intention use a new key", async () => {
  let uploads = 0;
  let keys = 0;
  const sent = [];
  const repo = repository({
    async upload() { uploads += 1; return upload(`receipt-${uploads}`); },
    async open(body, key) {
      sent.push([body.evidenciasRecepcion[0].recibo, key]);
      if (sent.length === 1) throw Object.assign(new Error("rejected"), { code: "EVIDENCIA_NO_APLICABLE", uncertain: false });
      return { ordenId: "10" };
    },
  });
  const flow = createReceptionFlow({ uuid: () => `key-${++keys}`, repository: repo, now: () => NOW });
  await flow.prepare(evidence);
  await assert.rejects(() => flow.submit(form), /rejected/);
  await flow.prepare(evidence);
  assert.deepEqual(await flow.submit(form), { id: "10" });
  assert.deepEqual(sent, [["receipt-1", "key-1"], ["receipt-2", "key-2"]]);
});

test("double tap sends one O02 with one key", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const repo = repository({
    async open(body, key) { repo.calls.push(["O02", body, key]); await gate; return { ordenId: "10" }; },
  });
  const flow = createReceptionFlow({ uuid: () => "unique-key", repository: repo, now: () => NOW });
  await flow.prepare(evidence);
  const first = flow.submit(form);
  assert.equal(await flow.submit(form), null);
  release();
  assert.deepEqual(await first, { id: "10" });
  assert.equal(repo.calls.filter((call) => call[0] === "O02").length, 1);
});
