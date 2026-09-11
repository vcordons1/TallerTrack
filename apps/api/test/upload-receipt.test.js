import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import sharp from "sharp";

import { createPreparedPrivateUpload } from "../src/platform/prepared-private-upload.js";
import { createPrivateFileStorage } from "../src/platform/private-file-storage.js";
import { createTechnicalImageValidator } from "../src/platform/technical-image-validator.js";
import {
  DEFAULT_UPLOAD_RECEIPT_MAX_LENGTH,
  createUploadReceiptSigner,
} from "../src/platform/upload-receipt.js";

const secret = Buffer.alloc(32, 0x72);
const actorId = "42";
const context = Object.freeze({
  tipo: "RECEPCION_PREVIA",
  vehiculoId: "101",
  propiedadEsperadaId: "202",
  propietarioEsperadoId: "303",
});
const object = Object.freeze({
  objectKey: "a".repeat(32),
  mimeType: "image/png",
  sizeBytes: 1234,
  sha256: "b".repeat(64),
});

function signer(options = {}) {
  return createUploadReceiptSigner({
    hmacKey: secret,
    ttlSeconds: 60,
    now: () => 1_700_000_000_000,
    generateIntentId: () => "12345678-1234-4567-89ab-1234567890ab",
    ...options,
  });
}

function tamperPayload(receipt, mutate) {
  const [format, encodedPayload, signature] = receipt.split(".");
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  mutate(payload);
  return `${format}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
}

function verify(receipt, instance = signer(), expectedContext = context, expectedActorId = actorId) {
  return instance.verify(receipt, { expectedActorId, expectedContext });
}

test("a valid receipt recovers the exact signed object, actor, and RECEPCION_PREVIA context", () => {
  const instance = signer();
  const { receipt, payload } = instance.issue({ actorId, context, object });
  assert.deepEqual(verify(receipt, instance), payload);
  assert.deepEqual(payload.context, context);
  assert.equal(payload.actorId, actorId);
  assert.deepEqual(
    {
      objectKey: payload.objectKey,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
      sha256: payload.sha256,
    },
    { ...object, sizeBytes: String(object.sizeBytes) },
  );
});

test("every closed ContextoCarga variant round-trips without dropping or adding fields", () => {
  const contexts = [
    context,
    { tipo: "CONSENTIMIENTO", ordenId: "1", presupuestoId: "2", hashContenido: "c".repeat(64) },
    { tipo: "DETENCION", ordenId: "1" },
    { tipo: "RECEPCION", ordenId: "1" },
    { tipo: "ENTREGA", ordenId: "1" },
    { tipo: "DIAGNOSTICO", ordenId: "1", trabajoDiagnosticoId: "2" },
    { tipo: "TRABAJO", ordenId: "1", trabajoId: "2" },
    { tipo: "AMPLIACION", ordenId: "1", presupuestoId: "2" },
    { tipo: "GARANTIA", ordenId: "1", reclamoId: "2" },
  ];
  const instance = signer();
  for (const uploadContext of contexts) {
    const { receipt } = instance.issue({ actorId, context: uploadContext, object });
    assert.deepEqual(
      instance.verify(receipt, { expectedActorId: actorId, expectedContext: uploadContext }).context,
      uploadContext,
    );
  }
  assert.throws(
    () => instance.issue({ actorId, context: { ...context, unexpected: "field" }, object }),
    { code: "INVALID_UPLOAD_RECEIPT" },
  );
});

test("independent changes to every bound fact invalidate the signature", () => {
  const { receipt } = signer().issue({ actorId, context, object });
  const mutations = {
    "object key": (payload) => { payload.objectKey = "c".repeat(32); },
    hash: (payload) => { payload.sha256 = "d".repeat(64); },
    size: (payload) => { payload.sizeBytes = "1235"; },
    MIME: (payload) => { payload.mimeType = "image/jpeg"; },
    actor: (payload) => { payload.actorId = "43"; },
    vehicle: (payload) => { payload.context.vehiculoId = "102"; },
    property: (payload) => { payload.context.propiedadEsperadaId = "203"; },
    owner: (payload) => { payload.context.propietarioEsperadoId = "304"; },
    context: (payload) => {
      payload.context = { tipo: "RECEPCION", ordenId: "101" };
    },
    expiration: (payload) => { payload.expiresAt += 1000; },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    assert.throws(() => verify(tamperPayload(receipt, mutate)), { code: "INVALID_UPLOAD_RECEIPT" }, label);
  }
});

test("expiration uses an injected clock and has no sleep-based boundary", () => {
  let current = 10_000;
  const instance = signer({ ttlSeconds: 10, now: () => current });
  const { receipt, payload } = instance.issue({ actorId, context, object });
  current = payload.expiresAt - 1;
  assert.deepEqual(verify(receipt, instance), payload);
  current = payload.expiresAt + 1;
  assert.throws(() => verify(receipt, instance), { code: "UPLOAD_RECEIPT_EXPIRED" });
});

test("expected actor and each expected context coordinate must match", () => {
  const instance = signer();
  const { receipt } = instance.issue({ actorId, context, object });
  const mismatches = [
    ["43", context],
    [actorId, { ...context, vehiculoId: "999" }],
    [actorId, { ...context, propiedadEsperadaId: "999" }],
    [actorId, { ...context, propietarioEsperadoId: "999" }],
    [actorId, { tipo: "RECEPCION", ordenId: "101" }],
  ];
  for (const [expectedActorId, expectedContext] of mismatches) {
    assert.throws(
      () => verify(receipt, instance, expectedContext, expectedActorId),
      { code: "UPLOAD_RECEIPT_CONTEXT_MISMATCH" },
    );
  }
});

test("truncation, malformed encoding, unknown versions, corrupt payloads, and excess length fail safely", () => {
  const { receipt } = signer().issue({ actorId, context, object });
  const [format, payload, signature] = receipt.split(".");
  const malformed = [
    receipt.slice(0, -8),
    `${format}.${payload}.${signature.slice(0, -1)}`,
    `ttur2.${payload}.${signature}`,
    `${format}.!not-base64!.${signature}`,
    `${format}.${payload}.!not-base64!`,
    `${format}.${`${payload.slice(0, -1)}A`}.${signature}`,
    "x".repeat(DEFAULT_UPLOAD_RECEIPT_MAX_LENGTH + 1),
  ];
  for (const value of malformed) {
    assert.throws(() => verify(value), { code: "INVALID_UPLOAD_RECEIPT" });
  }
});

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tallertrack-receipt-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function pngFixture(background = { r: 20, g: 80, b: 140 }) {
  return sharp({ create: { width: 5, height: 4, channels: 3, background } }).png().toBuffer();
}

function integratedService(root, receiptSigner = signer()) {
  const storage = createPrivateFileStorage({ rootDirectory: root, maxFileBytes: 1024 * 1024 });
  const validateTechnicalImage = createTechnicalImageValidator({ maxPixels: 1_000_000, maxDimension: 2000 });
  return {
    storage,
    service: createPreparedPrivateUpload({ storage, validateTechnicalImage, receiptSigner }),
  };
}

test("real storage publishes and verifies bytes before issuing a path-free receipt", async (t) => {
  const root = await temporaryDirectory(t);
  const bytes = await pngFixture();
  const { storage, service } = integratedService(root);
  const prepared = await service.prepare({
    source: Readable.from(bytes), declaredMimeType: "image/png", actorId, context,
  });

  assert.equal(await storage.exists(prepared.objectKey), true);
  assert.equal(prepared.sizeBytes, bytes.length);
  assert.equal(prepared.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(prepared.mimeType, "image/png");
  assert.equal(prepared.receipt.includes(root), false);
  assert.equal(prepared.receipt.includes(secret.toString("base64")), false);
  const payload = await service.verifyAndRevalidate({
    receipt: prepared.receipt, expectedActorId: actorId, expectedContext: context,
  });
  assert.equal(payload.objectKey, prepared.objectKey);
});

test("failed validation publishes no object and therefore emits no receipt", async (t) => {
  const root = await temporaryDirectory(t);
  const { service } = integratedService(root);
  await assert.rejects(
    service.prepare({
      source: Readable.from(Buffer.from("not an image")),
      declaredMimeType: "image/png",
      actorId,
      context,
    }),
    { code: "IMAGE_VALIDATION_FAILED" },
  );
  assert.deepEqual(await readdir(root), []);
});

test("missing or modified real objects fail revalidation without leaking paths or secrets", async (t) => {
  const root = await temporaryDirectory(t);
  const original = await pngFixture();
  const replacement = await pngFixture({ r: 200, g: 40, b: 20 });
  const { storage, service } = integratedService(root);

  const missing = await service.prepare({
    source: Readable.from(original), declaredMimeType: "image/png", actorId, context,
  });
  await storage.deleteOrphan(missing.objectKey);
  await assert.rejects(
    service.verifyAndRevalidate({ receipt: missing.receipt, expectedActorId: actorId, expectedContext: context }),
    (error) => error.code === "PREPARED_OBJECT_NOT_FOUND"
      && !error.message.includes(root) && !error.message.includes(secret.toString("base64")),
  );

  const modified = await service.prepare({
    source: Readable.from(original), declaredMimeType: "image/png", actorId, context,
  });
  const target = path.join(root, modified.objectKey);
  await chmod(target, 0o600);
  await writeFile(target, replacement);
  await assert.rejects(
    service.verifyAndRevalidate({ receipt: modified.receipt, expectedActorId: actorId, expectedContext: context }),
    (error) => error.code === "PREPARED_OBJECT_METADATA_MISMATCH"
      && !error.message.includes(root) && !error.message.includes(secret.toString("base64")),
  );
});
