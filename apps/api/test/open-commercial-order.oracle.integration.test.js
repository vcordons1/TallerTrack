import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import oracledb from "oracledb";
import sharp from "sharp";

import { createOpenCommercialOrder } from "../src/modules/service-orders/open-commercial-order.js";
import { createOraclePoolManager } from "../src/platform/oracle-pool.js";
import { createPreparedPrivateUpload } from "../src/platform/prepared-private-upload.js";
import { createPrivateFileStorage } from "../src/platform/private-file-storage.js";
import { createTechnicalImageValidator } from "../src/platform/technical-image-validator.js";
import { createUploadReceiptSigner } from "../src/platform/upload-receipt.js";

const enabled = process.env.TT_RUN_T01_ORACLE_INTEGRATION === "1";

test("real filesystem receipt is consumed by T01 through one real Oracle connection", { skip: !enabled }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tallertrack-t01-node-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = createPrivateFileStorage({ rootDirectory: root, maxFileBytes: 1024 * 1024 });
  await storage.initialize();
  const validator = createTechnicalImageValidator({ maxPixels: 1_000_000, maxDimension: 2000 });
  let clock = Date.now();
  const receiptSigner = createUploadReceiptSigner({
    hmacKey: Buffer.alloc(32, 0x54), ttlSeconds: 300, now: () => clock,
  });
  const preparedUpload = createPreparedPrivateUpload({
    storage, validateTechnicalImage: validator, receiptSigner,
  });
  const context = {
    tipo: "RECEPCION_PREVIA",
    vehiculoId: process.env.TT_T01_VEHICLE_ID,
    propiedadEsperadaId: process.env.TT_T01_PROPERTY_ID,
    propietarioEsperadoId: process.env.TT_T01_OWNER_ID,
  };
  const bytes = await sharp({
    create: { width: 8, height: 6, channels: 3, background: { r: 25, g: 90, b: 150 } },
  }).png().toBuffer();
  const prepared = await preparedUpload.prepare({
    source: Readable.from(bytes), declaredMimeType: "image/png",
    actorId: process.env.TT_T01_ACTOR_ID, context,
  });
  const poolManager = createOraclePoolManager({
    driver: oracledb,
    config: {
      user: process.env.TT_ORACLE_USER,
      password: process.env.TT_ORACLE_PASSWORD,
      connectString: process.env.TT_ORACLE_CONNECT_STRING,
      poolMin: 0, poolMax: 2, poolIncrement: 1, queueTimeout: 5000, poolTimeout: 60,
    },
  });
  await poolManager.initialize();
  t.after(() => poolManager.close());
  const open = createOpenCommercialOrder({
    preparedUpload, poolManager, schema: process.env.TT_ORACLE_SCHEMA,
    maximumFiles: 10, driver: oracledb,
  });
  const command = {
    actorId: process.env.TT_T01_ACTOR_ID,
    sessionId: process.env.TT_T01_SESSION_ID,
    idempotencyKey: "node-real-filesystem-oracle",
    correlationId: "node-real-filesystem-oracle",
    vehicleId: context.vehiculoId,
    expectedPropertyId: context.propiedadEsperadaId,
    expectedOwnerId: context.propietarioEsperadoId,
    mileageEntry: "321.0",
    entryReason: "Recepcion integrada Node Oracle",
    visibleDamage: "Sin danos visibles",
    receptionEvidence: [{ receipt: prepared.receipt, description: "Vista frontal integrada" }],
  };
  const created = await open(command);
  assert.deepEqual(
    { state: created.state, version: created.version, client: created.contractualClientId, property: created.openingPropertyId, repeated: created.repeated },
    { state: "RECIBIDO", version: 1, client: context.propietarioEsperadoId, property: context.propiedadEsperadaId, repeated: false },
  );
  assert.equal(created.evidenceIds.length, 1);
  const retried = await open(command);
  assert.equal(retried.orderId, created.orderId);
  assert.deepEqual(retried.evidenceIds, created.evidenceIds);
  assert.equal(retried.repeated, true);
  assert.equal(await storage.exists(prepared.objectKey), true);

  // Lost response + expired receipt: the same intention resolves to the same order
  // through the read-only lookup; a new intention with that receipt is still refused.
  clock += 301_000;
  const afterExpiry = await open(command);
  assert.equal(afterExpiry.orderId, created.orderId);
  assert.deepEqual(afterExpiry.evidenceIds, created.evidenceIds);
  assert.equal(afterExpiry.repeated, true);
  await assert.rejects(open({ ...command, idempotencyKey: "node-expired-new-intention" }), { code: "UPLOAD_RECEIPT_EXPIRED" });
  await assert.rejects(open({ ...command, entryReason: "Otro contenido" }), { code: "CLAVE_REUTILIZADA" });
});
