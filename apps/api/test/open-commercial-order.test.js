import assert from "node:assert/strict";
import test from "node:test";

import { createOpenCommercialOrder } from "../src/modules/service-orders/open-commercial-order.js";

const driver = Object.freeze({ BIND_IN: 1, BIND_OUT: 2, CLOB: 3, STRING: 4, NUMBER: 5 });

function request(overrides = {}) {
  return {
    actorId: "100",
    sessionId: "400",
    idempotencyKey: "open-1",
    correlationId: "corr-open-1",
    vehicleId: "1000",
    expectedPropertyId: "1100",
    expectedOwnerId: "200",
    mileageEntry: "12345.6",
    entryReason: "Revision general",
    visibleDamage: "Sin danos visibles",
    receptionEvidence: [{ receipt: "signed-a", description: "Frente del vehiculo" }],
    ...overrides,
  };
}

function payload(suffix = "a") {
  return {
    intentId: `12345678-1234-4567-89ab-1234567890a${suffix}`,
    objectKey: suffix.repeat(32),
    mimeType: "image/png",
    sizeBytes: "123",
    sha256: suffix.repeat(64),
  };
}

function harness({ executeError } = {}) {
  const events = [];
  const preparedUpload = {
    async verifyAndRevalidate(argument) {
      events.push(["verify", argument]);
      return payload(argument.receipt.endsWith("b") ? "b" : "a");
    },
  };
  const connection = {
    async execute(sql, binds, options) {
      events.push(["execute", sql, binds, options]);
      if (executeError) throw executeError;
      return { outBinds: {
        orderId: "700", state: "RECIBIDO", version: "1", clientId: "200",
        propertyId: "1100", evidenceIdsJson: "[800,801]", repeated: 0,
      } };
    },
    async commit() { events.push(["commit"]); },
    async rollback() { events.push(["rollback"]); },
    async close() { events.push(["close"]); },
  };
  const poolManager = {
    async getConnection() { events.push(["connection"]); return connection; },
  };
  return {
    events,
    open: createOpenCommercialOrder({
      preparedUpload, poolManager, schema: "TT_OWNER", maximumFiles: 10, driver,
    }),
  };
}

test("all receipts are context-checked and revalidated before one Oracle transaction", async () => {
  const { events, open } = harness();
  const result = await open(request({
    receptionEvidence: [
      { receipt: "signed-a", description: "Frente" },
      { receipt: "signed-b", description: "Costado" },
    ],
  }));

  assert.deepEqual(result, {
    orderId: "700", state: "RECIBIDO", version: 1, contractualClientId: "200",
    openingPropertyId: "1100", evidenceIds: [800, 801], repeated: false,
  });
  assert.deepEqual(events.map(([name]) => name), ["verify", "verify", "connection", "execute", "commit", "close"]);
  for (const [, argument] of events.filter(([name]) => name === "verify")) {
    assert.deepEqual(argument.expectedContext, {
      tipo: "RECEPCION_PREVIA", vehiculoId: "1000",
      propiedadEsperadaId: "1100", propietarioEsperadoId: "200",
    });
    assert.equal(argument.expectedActorId, "100");
  }
  const execute = events.find(([name]) => name === "execute");
  assert.equal(execute[3].autoCommit, false);
  assert.equal(execute[2].scope, "actor:100/T01");
  assert.equal(Buffer.isBuffer(execute[2].requestHash), true);
  assert.deepEqual(JSON.parse(execute[2].evidenceJson.val).map(({ objectKey }) => objectKey), ["a".repeat(32), "b".repeat(32)]);
});

test("receipt or storage failure occurs before obtaining an Oracle connection", async () => {
  const events = [];
  const expected = Object.assign(new Error("expired"), { code: "UPLOAD_RECEIPT_EXPIRED" });
  const open = createOpenCommercialOrder({
    preparedUpload: { async verifyAndRevalidate() { events.push("verify"); throw expected; } },
    poolManager: { async getConnection() { events.push("connection"); throw new Error("must not run"); } },
    schema: "TT_OWNER", maximumFiles: 10, driver,
  });
  await assert.rejects(open(request()), (error) => error === expected);
  assert.deepEqual(events, ["verify"]);
});

test("an Oracle failure rolls back and always releases the sole connection", async () => {
  const oracleError = new Error("ORA-20021: PROPIEDAD_CAMBIADA");
  const { events, open } = harness({ executeError: oracleError });
  await assert.rejects(open(request()), { code: "PROPIEDAD_CAMBIADA" });
  assert.deepEqual(events.map(([name]) => name), ["verify", "connection", "execute", "rollback", "close"]);
});

test("the internal DTO rejects missing evidence, arbitrary timestamps and caller-controlled state", async () => {
  const { events, open } = harness();
  await assert.rejects(open(request({ receptionEvidence: [] })), { code: "EVIDENCE_REQUIRED" });
  await assert.rejects(open(request({ state: "ENTREGADO" })), { code: "INVALID_ORDER_OPENING" });
  await assert.rejects(open(request({ enteredAt: new Date().toISOString() })), { code: "INVALID_ORDER_OPENING" });
  assert.deepEqual(events, []);
});
