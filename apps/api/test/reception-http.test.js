import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";

import sharp from "sharp";

import { createApp } from "../src/app.js";
import { createPreparedPrivateUpload } from "../src/platform/prepared-private-upload.js";
import { createPrivateFileStorage } from "../src/platform/private-file-storage.js";
import { createTechnicalImageValidator } from "../src/platform/technical-image-validator.js";
import { createUploadReceiptSigner } from "../src/platform/upload-receipt.js";
import photoUpload from "../../mobile/src/features/reception/photoUpload.cjs";

const receptionistToken = "recepcion.a.a";
const administratorToken = "admin.a.a";
const mechanicToken = "mechanic.a.a";
const combinedToken = "combined.a.a";
const idempotency = "12345678-1234-4567-89ab-1234567890ab";

async function harness(t, { maxFileBytes = 1024 * 1024, uploadMaximumRequests = 20 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tallertrack-http-reception-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = createPrivateFileStorage({ rootDirectory: root, maxFileBytes });
  await storage.initialize();
  const preparedUpload = createPreparedPrivateUpload({
    storage,
    validateTechnicalImage: createTechnicalImageValidator({ maxPixels: 1_000_000, maxDimension: 2000 }),
    receiptSigner: createUploadReceiptSigner({ hmacKey: Buffer.alloc(32, 0x62), ttlSeconds: 300 }),
  });
  const opened = [];
  const identityService = {
    async authenticate(token) {
      const roles = token === administratorToken ? ["ADMINISTRADOR"]
        : token === mechanicToken ? ["MECANICO"]
          : token === combinedToken ? ["ADMINISTRADOR", "RECEPCIONISTA"] : ["RECEPCIONISTA"];
      return {
        userId: token === administratorToken ? "101" : "100",
        sessionId: token === administratorToken ? "401" : "400",
        type: "INTERNO",
        roles,
        acceso: {},
      };
    },
  };
  const app = createApp({
    identityService,
    preparedUpload,
    privateFileConfig: {
      maxFileBytes,
      multipartMaxFields: 1,
      multipartMaxFieldBytes: 4096,
      uploadMaximumRequests,
      uploadWindowSeconds: 60,
      uploadBucketCapacity: 5000,
    },
    async openCommercialOrder(command) {
      opened.push(command);
      return {
        orderId: "700", state: "RECIBIDO", version: 1,
        contractualClientId: "200", openingPropertyId: "1100",
        evidenceIds: [800], repeated: false, commandId: "900",
        confirmedAt: "2026-09-12T10:00:00.000000Z",
      };
    },
    logger: { error() {} },
  });
  const server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`, root, opened };
}

function context() {
  return {
    tipo: "RECEPCION_PREVIA",
    vehiculoId: "1000",
    propiedadEsperadaId: "1100",
    propietarioEsperadoId: "200",
  };
}

async function png() {
  return sharp({
    create: { width: 6, height: 4, channels: 3, background: { r: 20, g: 80, b: 140 } },
  }).png().toBuffer();
}

function uploadForm(bytes, mimeType = "image/png") {
  const form = new FormData();
  form.append("contexto", JSON.stringify(context()));
  form.append("archivo", new Blob([bytes], { type: mimeType }), "ignored-client-name.png");
  return form;
}

async function upload(baseUrl, form, token = receptionistToken) {
  return fetch(`${baseUrl}/interno/evidencias/cargar`, {
    method: "POST",
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    body: form,
  });
}

test("picker URI multipart reaches real E01 with the original JPEG and PNG bytes", async (t) => {
  const { baseUrl, root } = await harness(t);
  const cameraCache = await mkdtemp(path.join(os.tmpdir(), "tallertrack-picker-"));
  t.after(() => rm(cameraCache, { recursive: true, force: true }));
  class NativeFormData {
    parts = [];
    append(name, value) { this.parts.push([name, value]); }
  }
  class NativeFile {
    constructor(uri) {
      this.uri = uri;
      this.name = path.basename(fileURLToPath(uri));
      this.type = this.name.endsWith(".png") ? "image/png" : "image/jpeg";
    }
    async bytes() { return readFile(fileURLToPath(this.uri)); }
  }
  for (const [format, mimeType] of [["jpeg", "image/jpeg"], ["png", "image/png"]]) {
    const bytes = await sharp({ create: { width: 7, height: 5, channels: 3,
      background: { r: 20, g: 80, b: 140 } } })[format]().toBuffer();
    const filePath = path.join(cameraCache, `picker.${format}`);
    await writeFile(filePath, bytes);
    const native = photoUpload.createUploadForm({ uri: pathToFileURL(filePath).href, mimeType },
      context(), NativeFile, NativeFormData);
    const wire = new FormData();
    for (const [name, value] of native.parts) {
      if (typeof value === "string") wire.append(name, value);
      else wire.append(name, new Blob([await value.bytes()], { type: value.type }), value.name);
    }
    const response = await upload(baseUrl, wire);
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.data.tipoContenido, mimeType);
    assert.equal(payload.data.tamanoBytes, String(bytes.length));
    assert.equal(payload.data.sha256, createHash("sha256").update(bytes).digest("hex"));
  }
  assert.equal((await readdir(root)).length, 2);
});

test("E01 requires live RECEPCIONISTA auth and returns only canonical public metadata", async (t) => {
  const { baseUrl, root } = await harness(t);
  assert.equal((await upload(baseUrl, uploadForm(await png()), null)).status, 401);
  assert.equal((await upload(baseUrl, uploadForm(await png()), administratorToken)).status, 403);
  assert.equal((await upload(baseUrl, uploadForm(await png()), mechanicToken)).status, 403);

  const response = await upload(baseUrl, uploadForm(await png()));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(response.headers.get("x-request-id"));
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.json();
  assert.deepEqual(Object.keys(body.data).sort(), ["expiraEn", "recibo", "sha256", "tamanoBytes", "tipoContenido"]);
  assert.equal(body.data.tipoContenido, "image/png");
  assert.match(body.data.recibo, /^ttur1\./);
  assert.match(body.data.sha256, /^[0-9a-f]{64}$/);
  assert.equal((await readdir(root)).length, 1);
  assert.equal(JSON.stringify(body).includes(root), false);
  assert.equal((await upload(baseUrl, uploadForm(await png()), combinedToken)).status, 201);
});

test("E01 rejects corrupt, oversized, unknown and multiple parts without a published object", async (t) => {
  const { baseUrl, root } = await harness(t, { maxFileBytes: 100 });
  const corrupt = await upload(baseUrl, uploadForm(Buffer.from("<html>not an image</html>"), "image/png"));
  assert.equal(corrupt.status, 415);

  const oversized = await upload(baseUrl, uploadForm(Buffer.alloc(101), "image/png"));
  assert.equal(oversized.status, 413);

  const unknown = uploadForm(await png());
  unknown.append("actorId", "999");
  assert.equal((await upload(baseUrl, unknown)).status, 400);

  const multiple = uploadForm(await png());
  multiple.append("archivo", new Blob([await png()], { type: "image/png" }), "second.png");
  assert.equal((await upload(baseUrl, multiple)).status, 400);
  assert.deepEqual(await readdir(root), []);
});

test("E01 applies the bounded development upload rate profile after authorization", async (t) => {
  const { baseUrl } = await harness(t, { uploadMaximumRequests: 1 });
  assert.equal((await upload(baseUrl, uploadForm(await png()))).status, 201);
  const limited = await upload(baseUrl, uploadForm(await png()));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});

test("O02 derives actor/session, enforces strict JSON and exposes canonical command output", async (t) => {
  const { baseUrl, opened } = await harness(t);
  const body = {
    vehiculoId: "1000",
    propiedadEsperadaId: "1100",
    propietarioEsperadoId: "200",
    kilometrajeIngreso: "123.4",
    motivoIngreso: "Servicio preventivo",
    danosVisibles: "Sin daños visibles",
    evidenciasRecepcion: [{ recibo: "opaque", descripcion: "Vista frontal" }],
  };
  const response = await fetch(`${baseUrl}/interno/ordenes/abrir`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${receptionistToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotency,
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("location"), "/api/v1/interno/ordenes/700");
  const output = await response.json();
  assert.deepEqual(output.data, {
    ordenId: "700", version: "1", estado: "RECIBIDO", clienteContractualId: "200",
    propiedadAperturaId: "1100", citaId: null, evidenciasIds: ["800"], excepcionConsumidaId: null,
  });
  assert.deepEqual(
    { comandoId: output.meta.comandoId, confirmadoEn: output.meta.confirmadoEn, repetido: output.meta.repetido },
    { comandoId: "900", confirmadoEn: "2026-09-12T10:00:00.000000Z", repetido: false },
  );
  assert.equal(opened.length, 1);
  assert.deepEqual(
    { actorId: opened[0].actorId, sessionId: opened[0].sessionId, idempotencyKey: opened[0].idempotencyKey },
    { actorId: "100", sessionId: "400", idempotencyKey: idempotency },
  );

  const forbidden = await fetch(`${baseUrl}/interno/ordenes/abrir`, {
    method: "POST",
    headers: { Authorization: `Bearer ${administratorToken}`, "Content-Type": "application/json", "Idempotency-Key": idempotency },
    body: JSON.stringify(body),
  });
  assert.equal(forbidden.status, 403);
  const mechanic = await fetch(`${baseUrl}/interno/ordenes/abrir`, {
    method: "POST",
    headers: { Authorization: `Bearer ${mechanicToken}`, "Content-Type": "application/json", "Idempotency-Key": idempotency },
    body: JSON.stringify(body),
  });
  assert.equal(mechanic.status, 403);

  const combined = await fetch(`${baseUrl}/interno/ordenes/abrir`, {
    method: "POST",
    headers: { Authorization: `Bearer ${combinedToken}`, "Content-Type": "application/json", "Idempotency-Key": idempotency },
    body: JSON.stringify(body),
  });
  assert.equal(combined.status, 201);

  const injected = await fetch(`${baseUrl}/interno/ordenes/abrir`, {
    method: "POST",
    headers: { Authorization: `Bearer ${receptionistToken}`, "Content-Type": "application/json", "Idempotency-Key": idempotency },
    body: JSON.stringify({ ...body, actorId: "999" }),
  });
  assert.equal(injected.status, 400);
  assert.equal(opened.length, 2);
});
