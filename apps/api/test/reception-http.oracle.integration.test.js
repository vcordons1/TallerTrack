import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import oracledb from "oracledb";
import sharp from "sharp";

import { startServer } from "../src/server.js";

const enabled = process.env.TT_RUN_RECEPTION_HTTP_ORACLE_INTEGRATION === "1";

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function jsonRequest(url, { token, body, idempotencyKey } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

async function upload(url, token, bytes, context) {
  const form = new FormData();
  form.append("contexto", JSON.stringify(context));
  form.append("archivo", new Blob([bytes], { type: "image/png" }), "client-name-is-not-authority.png");
  const response = await fetch(url, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  return { response, body: await response.json() };
}

function opening(context, receipt, reason = "Recepción HTTP Oracle") {
  return {
    vehiculoId: context.vehiculoId,
    propiedadEsperadaId: context.propiedadEsperadaId,
    propietarioEsperadoId: context.propietarioEsperadoId,
    kilometrajeIngreso: "321.0",
    motivoIngreso: reason,
    danosVisibles: "Sin daños visibles",
    evidenciasRecepcion: [{ recibo: receipt, descripcion: "Vista frontal HTTP" }],
  };
}

test("login -> E01 -> O02 persists exact bytes and preserves auth, idempotency and HTTP concurrency",
  { skip: !enabled, timeout: 120_000 }, async (t) => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "tallertrack-http-oracle-"));
    t.after(() => rm(storageRoot, { recursive: true, force: true }));
    const logs = [];
    const environment = {
      ...process.env,
      TT_PRIVATE_STORAGE_ROOT: storageRoot,
      TT_EVIDENCE_MAX_FILE_BYTES: "1048576", TT_EVIDENCE_MAX_PIXELS: "1000000",
      TT_EVIDENCE_MAX_DIMENSION: "2000", TT_EVIDENCE_MAX_FILES_PER_OPERATION: "10",
      TT_EVIDENCE_MULTIPART_MAX_FIELDS: "1", TT_EVIDENCE_MULTIPART_MAX_FIELD_BYTES: "4096",
      TT_UPLOAD_RECEIPT_HMAC_KEY_BASE64: Buffer.alloc(32, 0x71).toString("base64"),
      TT_UPLOAD_RECEIPT_TTL_SECONDS: "300",
      TT_AUTH_SIGNING_KEY_BASE64: Buffer.alloc(32, 0x72).toString("base64"),
      TT_AUTH_ISSUER: "tallertrack-reception-test", TT_AUTH_AUDIENCE: "tallertrack-api-test",
      TT_AUTH_ACCESS_TTL_SECONDS: "600", TT_AUTH_SESSION_TTL_SECONDS: "43200",
      TT_AUTH_REFRESH_TTL_SECONDS: "43200", TT_AUTH_LOGIN_MAX_ATTEMPTS: "20",
      TT_AUTH_LOGIN_WINDOW_SECONDS: "900", TT_AUTH_LOGIN_BUCKET_CAPACITY: "5000",
      TT_AUTH_HASH_MAX_CONCURRENCY: "4",
    };
    const runtime = await startServer({
      environment, port: 0, logger: { log() {}, error(entry) { logs.push(entry); } },
    });
    t.after(() => runtime.shutdown("TEST"));
    const baseUrl = `http://127.0.0.1:${runtime.server.address().port}/api/v1`;
    const owner = await oracledb.getConnection({
      user: process.env.TT_AUTH_TEST_OWNER,
      password: process.env.TT_AUTH_TEST_OWNER_PASSWORD,
      connectString: process.env.TT_ORACLE_CONNECT_STRING,
    });
    t.after(() => owner.close());

    const login = await jsonRequest(`${baseUrl}/acceso/sesiones`, {
      body: { login: process.env.TT_AUTH_TEST_LOGIN, password: process.env.TT_AUTH_TEST_PASSWORD },
    });
    assert.equal(login.response.status, 201);
    const token = login.body.data.tokens.accessToken;
    const actorId = login.body.data.acceso.usuarioId;
    const bytes = await sharp({
      create: { width: 8, height: 6, channels: 3, background: { r: 25, g: 90, b: 150 } },
    }).png().toBuffer();
    const context = {
      tipo: "RECEPCION_PREVIA", vehiculoId: "1000",
      propiedadEsperadaId: "1100", propietarioEsperadoId: "200",
    };
    const prepared = await upload(`${baseUrl}/interno/evidencias/cargar`, token, bytes, context);
    assert.equal(prepared.response.status, 201);
    assert.equal(prepared.body.data.sha256, createHash("sha256").update(bytes).digest("hex"));

    const key = randomUUID();
    const first = await jsonRequest(`${baseUrl}/interno/ordenes/abrir`, {
      token, idempotencyKey: key, body: opening(context, prepared.body.data.recibo),
    });
    assert.equal(first.response.status, 201);
    assert.equal(first.body.data.estado, "RECIBIDO");
    assert.equal(first.body.meta.repetido, false);
    const replay = await jsonRequest(`${baseUrl}/interno/ordenes/abrir`, {
      token, idempotencyKey: key, body: opening(context, prepared.body.data.recibo),
    });
    assert.equal(replay.response.status, 201);
    assert.equal(replay.body.data.ordenId, first.body.data.ordenId);
    assert.equal(replay.body.meta.repetido, true);
    const conflict = await jsonRequest(`${baseUrl}/interno/ordenes/abrir`, {
      token, idempotencyKey: key,
      body: opening(context, prepared.body.data.recibo, "Contenido distinto"),
    });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.error.code, "CLAVE_REUTILIZADA");

    const facts = await owner.execute(`SELECT
      o.estado, o.id_propiedad_apertura, o.id_cliente,
      (SELECT COUNT(*) FROM orden_evento oe WHERE oe.id_orden=o.id_orden AND oe.tipo='APERTURA'),
      (SELECT COUNT(*) FROM evidencia e WHERE e.id_orden=o.id_orden AND e.contexto='RECEPCION'),
      (SELECT COUNT(*) FROM comando c WHERE c.id_comando=o.id_comando AND c.resultado_codigo=201),
      (SELECT COUNT(*) FROM auditoria_evento a WHERE a.id_comando=o.id_comando AND a.accion='ABRIR_ORDEN_COMERCIAL'),
      (SELECT ap.clave_objeto FROM evidencia e JOIN archivo_privado ap ON ap.id_archivo=e.id_archivo
       WHERE e.id_orden=o.id_orden FETCH FIRST 1 ROW ONLY)
      FROM orden_trabajo o WHERE o.id_orden=:id`, { id: first.body.data.ordenId });
    assert.deepEqual(facts.rows[0].slice(0, 7), ["RECIBIDO", 1100, 200, 1, 1, 1, 1]);
    assert.deepEqual(await readAll(await runtime.privateFileStorage.openObject(facts.rows[0][7])), bytes);

    const raceContext = {
      tipo: "RECEPCION_PREVIA", vehiculoId: "1001",
      propiedadEsperadaId: "1101", propietarioEsperadoId: "201",
    };
    const raceUpload = await upload(`${baseUrl}/interno/evidencias/cargar`, token, bytes, raceContext);
    assert.equal(raceUpload.response.status, 201);
    const raceBody = opening(raceContext, raceUpload.body.data.recibo, "Carrera HTTP");
    const race = await Promise.all([randomUUID(), randomUUID()].map((idempotencyKey) => (
      jsonRequest(`${baseUrl}/interno/ordenes/abrir`, { token, idempotencyKey, body: raceBody })
    )));
    assert.deepEqual(race.map(({ response }) => response.status).sort(), [201, 409]);
    assert.equal(race.find(({ response }) => response.status === 409).body.error.code, "ORDEN_ACTIVA_EXISTENTE");
    const raceCount = await owner.execute("SELECT COUNT(*) FROM orden_trabajo WHERE id_vehiculo=1001");
    assert.equal(raceCount.rows[0][0], 1);

    const guardedContext = {
      tipo: "RECEPCION_PREVIA", vehiculoId: "1002",
      propiedadEsperadaId: "1102", propietarioEsperadoId: "202",
    };
    const otherActor = await runtime.preparedUpload.prepare({
      source: Readable.from(bytes), declaredMimeType: "image/png", actorId: "999999",
      context: guardedContext,
    });
    const otherActorResponse = await jsonRequest(`${baseUrl}/interno/ordenes/abrir`, {
      token, idempotencyKey: randomUUID(), body: opening(guardedContext, otherActor.receipt),
    });
    assert.equal(otherActorResponse.response.status, 422);
    assert.equal(otherActorResponse.body.error.code, "EVIDENCIA_NO_APLICABLE");

    const mutable = await upload(`${baseUrl}/interno/evidencias/cargar`, token, bytes, guardedContext);
    assert.equal(mutable.response.status, 201);
    const mutablePayload = JSON.parse(Buffer.from(mutable.body.data.recibo.split(".")[1], "base64url").toString("utf8"));
    const mutablePath = path.join(storageRoot, mutablePayload.objectKey);
    await chmod(mutablePath, 0o600);
    await writeFile(mutablePath, Buffer.from("changed after upload"));
    const modifiedResponse = await jsonRequest(`${baseUrl}/interno/ordenes/abrir`, {
      token, idempotencyKey: randomUUID(), body: opening(guardedContext, mutable.body.data.recibo),
    });
    assert.equal(modifiedResponse.response.status, 422);
    assert.equal(modifiedResponse.body.error.code, "EVIDENCIA_NO_APLICABLE");

    const missing = await upload(`${baseUrl}/interno/evidencias/cargar`, token, bytes, guardedContext);
    assert.equal(missing.response.status, 201);
    const missingPayload = JSON.parse(Buffer.from(missing.body.data.recibo.split(".")[1], "base64url").toString("utf8"));
    assert.equal(await runtime.privateFileStorage.deleteOrphan(missingPayload.objectKey), true);
    const missingResponse = await jsonRequest(`${baseUrl}/interno/ordenes/abrir`, {
      token, idempotencyKey: randomUUID(), body: opening(guardedContext, missing.body.data.recibo),
    });
    assert.equal(missingResponse.response.status, 422);
    assert.equal(missingResponse.body.error.code, "EVIDENCIA_NO_APLICABLE");

    await owner.execute(`UPDATE usuario_rol SET retirado_en=SYSTIMESTAMP, retirado_por=id_usuario,
      motivo_retiro='HTTP live-role test' WHERE id_usuario=:id AND codigo_rol='RECEPCIONISTA' AND retirado_en IS NULL`,
    { id: actorId });
    await owner.commit();
    assert.ok([401, 403].includes(
      (await upload(`${baseUrl}/interno/evidencias/cargar`, token, bytes, raceContext)).response.status,
    ));
    assert.ok([401, 403].includes((await jsonRequest(`${baseUrl}/interno/ordenes/abrir`, {
      token, idempotencyKey: randomUUID(), body: raceBody,
    })).response.status));
    await owner.execute(`INSERT INTO usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por)
      VALUES(:id,'RECEPCIONISTA',SYSTIMESTAMP,:id)`, { id: actorId });
    await owner.commit();

    const serializedLogs = JSON.stringify(logs);
    for (const secret of [token, login.body.data.tokens.refreshToken, prepared.body.data.recibo,
      environment.TT_UPLOAD_RECEIPT_HMAC_KEY_BASE64, storageRoot, process.env.TT_AUTH_TEST_PASSWORD]) {
      assert.equal(serializedLogs.includes(secret), false);
    }
  });
