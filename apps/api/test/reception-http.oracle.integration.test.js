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

async function getJson(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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
    const customerSearch = await getJson(`${baseUrl}/interno/clientes?q=Cliente%20HTTP%200`, token);
    assert.equal(customerSearch.response.status, 200);
    assert.equal(customerSearch.body.data.length, 1);
    const customer = customerSearch.body.data[0];
    assert.equal(typeof customer.id, "string");
    assert.deepEqual(Object.keys(customer).sort(), [
      "accesoDigital", "activo", "direccion", "email", "id", "nit", "nombre", "telefono", "version",
    ]);
    assert.deepEqual((await getJson(`${baseUrl}/interno/clientes?q=%25%25`, token)).body.data, []);
    assert.deepEqual((await getJson(`${baseUrl}/interno/clientes?q=__`, token)).body.data, []);

    const vehicleSearch = await getJson(`${baseUrl}/interno/vehiculos?clienteId=${customer.id}`, token);
    assert.equal(vehicleSearch.response.status, 200);
    assert.equal(vehicleSearch.body.data.length, 1);
    const searchedVehicle = vehicleSearch.body.data[0];
    const vehicleDetail = await getJson(`${baseUrl}/interno/vehiculos/${searchedVehicle.id}`, token);
    assert.equal(vehicleDetail.response.status, 200);
    assert.deepEqual(vehicleDetail.body.data, searchedVehicle);

    const pageOne = await getJson(`${baseUrl}/interno/clientes?limite=2`, token);
    assert.equal(pageOne.response.status, 200);
    assert.equal(pageOne.body.data.length, 2);
    assert.equal(pageOne.body.page.hayMas, true);
    const expectedCustomerOrder = await owner.execute(
      "SELECT TO_CHAR(id_cliente) FROM cliente ORDER BY creado_en DESC,id_cliente DESC FETCH FIRST 2 ROWS ONLY",
    );
    assert.deepEqual(pageOne.body.data.map(({ id }) => id), expectedCustomerOrder.rows.map(([id]) => id));
    await owner.execute(`INSERT INTO cliente(nombre,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
      VALUES('Cliente concurrente',1,SYSTIMESTAMP,:actor,SYSTIMESTAMP,:actor,1)`, { actor: actorId });
    await owner.commit();
    const pageTwo = await getJson(`${baseUrl}/interno/clientes?limite=2&cursor=${encodeURIComponent(pageOne.body.page.siguienteCursor)}`, token);
    assert.equal(pageTwo.response.status, 200);
    assert.equal(pageOne.body.data.some((firstRow) => pageTwo.body.data.some((secondRow) => secondRow.id === firstRow.id)), false);
    const wrongCursorFilter = await getJson(`${baseUrl}/interno/clientes?limite=2&activo=false&cursor=${encodeURIComponent(pageOne.body.page.siguienteCursor)}`, token);
    assert.equal(wrongCursorFilter.response.status, 400);
    assert.equal(wrongCursorFilter.body.error.code, "CURSOR_INVALIDO");
    const cursorParts = pageOne.body.page.siguienteCursor.split(".");
    cursorParts[3] = `${cursorParts[3][0] === "A" ? "B" : "A"}${cursorParts[3].slice(1)}`;
    const tamperedCursor = cursorParts.join(".");
    assert.equal((await getJson(`${baseUrl}/interno/clientes?limite=2&cursor=${encodeURIComponent(tamperedCursor)}`, token)).response.status, 400);

    const bytes = await sharp({
      create: { width: 8, height: 6, channels: 3, background: { r: 25, g: 90, b: 150 } },
    }).png().toBuffer();
    const context = {
      tipo: "RECEPCION_PREVIA", vehiculoId: searchedVehicle.id,
      propiedadEsperadaId: searchedVehicle.propiedadActual.id,
      propietarioEsperadoId: searchedVehicle.propiedadActual.clienteId,
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

    const orderList = await getJson(`${baseUrl}/interno/ordenes?vehiculoId=${searchedVehicle.id}`, token);
    assert.equal(orderList.response.status, 200);
    assert.equal(orderList.body.data.some(({ id }) => id === first.body.data.ordenId), true);
    const orderDetail = await getJson(`${baseUrl}/interno/ordenes/${first.body.data.ordenId}`, token);
    assert.equal(orderDetail.response.status, 200);
    assert.equal(orderDetail.body.data.id, first.body.data.ordenId);
    assert.equal(orderDetail.body.data.clienteContractual.id, customer.id);
    assert.equal(orderDetail.body.data.propiedadAperturaId, context.propiedadEsperadaId);
    assert.deepEqual(orderDetail.body.data.saldo, {
      moneda: "GTQ", montoDebido: "0.00", pagadoValido: "0.00", saldoNeto: "0.00",
      saldoPendiente: "0.00", saldoAFavor: "0.00", estadoEconomico: "SIN_CARGOS",
      deudaVencida: false, entregadoEn: null, calculadoEn: orderDetail.body.data.saldo.calculadoEn,
    });

    const facts = await owner.execute(`SELECT
      o.estado, o.id_propiedad_apertura, o.id_cliente,
      (SELECT COUNT(*) FROM orden_evento oe WHERE oe.id_orden=o.id_orden AND oe.tipo='APERTURA'),
      (SELECT COUNT(*) FROM evidencia e WHERE e.id_orden=o.id_orden AND e.contexto='RECEPCION'),
      (SELECT COUNT(*) FROM comando c WHERE c.id_comando=o.id_comando AND c.resultado_codigo=201),
      (SELECT COUNT(*) FROM auditoria_evento a WHERE a.id_comando=o.id_comando AND a.accion='ABRIR_ORDEN_COMERCIAL'),
      (SELECT ap.clave_objeto FROM evidencia e JOIN archivo_privado ap ON ap.id_archivo=e.id_archivo
       WHERE e.id_orden=o.id_orden FETCH FIRST 1 ROW ONLY)
      FROM orden_trabajo o WHERE o.id_orden=:id`, { id: first.body.data.ordenId });
    assert.deepEqual(facts.rows[0].slice(0, 7), [
      "RECIBIDO", Number(context.propiedadEsperadaId), Number(customer.id), 1, 1, 1, 1,
    ]);
    assert.deepEqual(await readAll(await runtime.privateFileStorage.openObject(facts.rows[0][7])), bytes);

    const destinationSearch = await getJson(`${baseUrl}/interno/clientes?q=Cliente%20HTTP%201`, token);
    assert.equal(destinationSearch.response.status, 200);
    const destination = destinationSearch.body.data[0];
    const transfer = await owner.execute(`BEGIN pkg_vehiculos.transferir_propiedad(
      :scope,:key,:requestHash,:actor,NULL,:correlation,:vehicleId,:propertyId,:ownerId,:newOwnerId,
      'Transferencia real TT-022',:qrHash,NULL,:previousProperty,:newProperty,:qrId,:repeated
    ); END;`, {
      scope: `actor:${actorId}/TT022`, key: randomUUID(), requestHash: createHash("sha256").update(randomUUID()).digest(),
      actor: actorId, correlation: randomUUID(), vehicleId: searchedVehicle.id,
      propertyId: context.propiedadEsperadaId, ownerId: customer.id, newOwnerId: destination.id,
      qrHash: createHash("sha256").update(randomUUID()).digest(),
      previousProperty: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 40 },
      newProperty: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 40 },
      qrId: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 40 },
      repeated: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    }, { autoCommit: false });
    await owner.commit();
    assert.equal(transfer.outBinds.previousProperty, context.propiedadEsperadaId);
    const oldOwnerVehicles = await getJson(`${baseUrl}/interno/vehiculos?clienteId=${customer.id}`, token);
    assert.equal(oldOwnerVehicles.body.data.some(({ id }) => id === searchedVehicle.id), false);
    const newOwnerVehicles = await getJson(`${baseUrl}/interno/vehiculos?clienteId=${destination.id}`, token);
    assert.equal(newOwnerVehicles.body.data.some(({ id }) => id === searchedVehicle.id), true);
    const transferredVehicle = await getJson(`${baseUrl}/interno/vehiculos/${searchedVehicle.id}`, token);
    assert.equal(transferredVehicle.body.data.propiedadActual.clienteId, destination.id);
    assert.equal(transferredVehicle.body.data.propiedadActual.id, transfer.outBinds.newProperty);
    const historicalOrder = await getJson(`${baseUrl}/interno/ordenes/${first.body.data.ordenId}`, token);
    assert.equal(historicalOrder.body.data.clienteContractual.id, customer.id);
    assert.equal(historicalOrder.body.data.propiedadAperturaId, context.propiedadEsperadaId);

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
    const otherOrderId = race.find(({ response }) => response.status === 201).body.data.ordenId;
    const firstOrderPage = await getJson(`${baseUrl}/interno/ordenes?limite=1`, token);
    assert.equal(firstOrderPage.response.status, 200);
    assert.equal(firstOrderPage.body.data.length, 1);
    assert.equal(firstOrderPage.body.page.hayMas, true);
    const secondOrderPage = await getJson(`${baseUrl}/interno/ordenes?limite=1&cursor=${encodeURIComponent(firstOrderPage.body.page.siguienteCursor)}`, token);
    assert.equal(secondOrderPage.response.status, 200);
    assert.equal(secondOrderPage.body.data.length, 1);
    const expectedOrder = await owner.execute(
      "SELECT TO_CHAR(id_orden) FROM orden_trabajo ORDER BY ingresado_en DESC,id_orden DESC",
    );
    assert.deepEqual([firstOrderPage.body.data[0].id, secondOrderPage.body.data[0].id],
      expectedOrder.rows.map(([id]) => id));
    assert.deepEqual(new Set(expectedOrder.rows.map(([id]) => id)), new Set([first.body.data.ordenId, otherOrderId]));
    assert.equal(secondOrderPage.body.page.hayMas, false);
    assert.equal(secondOrderPage.body.page.siguienteCursor, null);
    const wrongOrderCursor = await getJson(`${baseUrl}/interno/ordenes?limite=1&estado=ENTREGADO&cursor=${encodeURIComponent(firstOrderPage.body.page.siguienteCursor)}`, token);
    assert.equal(wrongOrderCursor.response.status, 400);
    assert.equal(wrongOrderCursor.body.error.code, "CURSOR_INVALIDO");
    const emptyOrders = await getJson(`${baseUrl}/interno/ordenes?estado=ENTREGADO`, token);
    assert.deepEqual(emptyOrders.body.data, []);
    assert.deepEqual(emptyOrders.body.page, { siguienteCursor: null, hayMas: false });

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
    await owner.execute(`INSERT INTO usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por)
      VALUES(:id,'MECANICO',SYSTIMESTAMP,:id)`, { id: actorId });
    await owner.commit();
    assert.ok([401, 403].includes(
      (await upload(`${baseUrl}/interno/evidencias/cargar`, token, bytes, raceContext)).response.status,
    ));
    assert.ok([401, 403].includes((await jsonRequest(`${baseUrl}/interno/ordenes/abrir`, {
      token, idempotencyKey: randomUUID(), body: raceBody,
    })).response.status));
    assert.equal((await getJson(`${baseUrl}/interno/clientes`, token)).response.status, 403);
    assert.equal((await getJson(`${baseUrl}/interno/vehiculos`, token)).response.status, 403);
    assert.equal((await getJson(`${baseUrl}/interno/vehiculos/${searchedVehicle.id}`, token)).response.status, 403);

    const mechanicOrders = await getJson(`${baseUrl}/interno/ordenes`, token);
    assert.equal(mechanicOrders.response.status, 200);
    assert.deepEqual(mechanicOrders.body.data, []);
    assert.equal((await getJson(`${baseUrl}/interno/ordenes/${first.body.data.ordenId}`, token)).response.status, 404);
    await owner.execute(`INSERT INTO orden_mecanico(id_orden,id_mecanico,asignado_en,asignado_por)
      VALUES(:orderId,:actorId,SYSTIMESTAMP,:actorId)`, { orderId: first.body.data.ordenId, actorId });
    await owner.commit();
    const assignedOrders = await getJson(`${baseUrl}/interno/ordenes`, token);
    assert.equal(assignedOrders.response.status, 200);
    assert.deepEqual(assignedOrders.body.data.map(({ id }) => id), [first.body.data.ordenId]);
    assert.equal("clienteContractual" in assignedOrders.body.data[0], false);
    assert.equal("saldo" in assignedOrders.body.data[0], false);
    const assignedDetail = await getJson(`${baseUrl}/interno/ordenes/${first.body.data.ordenId}`, token);
    assert.equal(assignedDetail.response.status, 200);
    assert.equal("clienteContractual" in assignedDetail.body.data, false);
    assert.equal((await getJson(`${baseUrl}/interno/ordenes/${otherOrderId}`, token)).response.status, 404);
    await owner.execute(`UPDATE orden_mecanico SET retirado_en=SYSTIMESTAMP, retirado_por=:actorId,
      motivo_retiro='Retiro de prueba TT-022' WHERE id_orden=:orderId AND id_mecanico=:actorId AND retirado_en IS NULL`,
    { orderId: first.body.data.ordenId, actorId });
    await owner.commit();
    assert.equal((await getJson(`${baseUrl}/interno/ordenes/${first.body.data.ordenId}`, token)).response.status, 404);

    await owner.execute(`UPDATE usuario_rol SET retirado_en=SYSTIMESTAMP, retirado_por=:id, motivo_retiro='Cambio de prueba'
      WHERE id_usuario=:id AND codigo_rol='MECANICO' AND retirado_en IS NULL`, { id: actorId });
    await owner.execute(`INSERT INTO usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por)
      VALUES(:id,'INVENTARIO',SYSTIMESTAMP,:id)`, { id: actorId });
    await owner.commit();
    assert.equal((await getJson(`${baseUrl}/interno/clientes`, token)).response.status, 403);
    assert.equal((await getJson(`${baseUrl}/interno/vehiculos`, token)).response.status, 403);
    assert.equal((await getJson(`${baseUrl}/interno/vehiculos/${searchedVehicle.id}`, token)).response.status, 403);
    const inventoryOrders = await getJson(`${baseUrl}/interno/ordenes`, token);
    assert.equal(inventoryOrders.response.status, 200);
    const inventoryOrder = inventoryOrders.body.data.find(({ id }) => id === first.body.data.ordenId);
    assert.deepEqual(Object.keys(inventoryOrder).sort(), ["detencion", "estado", "id", "proposito", "version"]);

    await owner.execute(`UPDATE usuario_rol SET retirado_en=SYSTIMESTAMP, retirado_por=:id, motivo_retiro='Cambio de prueba'
      WHERE id_usuario=:id AND codigo_rol='INVENTARIO' AND retirado_en IS NULL`, { id: actorId });
    await owner.execute(`INSERT INTO usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por)
      VALUES(:id,'ADMINISTRADOR',SYSTIMESTAMP,:id)`, { id: actorId });
    await owner.commit();
    assert.equal((await getJson(`${baseUrl}/interno/clientes`, token)).response.status, 200);
    assert.equal((await getJson(`${baseUrl}/interno/vehiculos`, token)).response.status, 200);
    assert.equal((await getJson(`${baseUrl}/interno/vehiculos/${searchedVehicle.id}`, token)).response.status, 200);
    assert.equal((await getJson(`${baseUrl}/interno/ordenes/${first.body.data.ordenId}`, token)).response.status, 200);

    await owner.execute(`UPDATE usuario_rol SET retirado_en=SYSTIMESTAMP, retirado_por=:id, motivo_retiro='Cambio de prueba'
      WHERE id_usuario=:id AND codigo_rol='ADMINISTRADOR' AND retirado_en IS NULL`, { id: actorId });
    await owner.execute(`INSERT INTO usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por)
      VALUES(:id,'RECEPCIONISTA',SYSTIMESTAMP,:id)`, { id: actorId });
    await owner.commit();

    await owner.execute(`UPDATE sesion SET revocada_en=SYSTIMESTAMP, motivo_revocacion='Consulta revocada TT-022'
      WHERE id_usuario=:id AND revocada_en IS NULL`, { id: actorId });
    await owner.commit();
    assert.equal((await getJson(`${baseUrl}/interno/clientes`, token)).response.status, 401);

    const serializedLogs = JSON.stringify(logs);
    for (const secret of [token, login.body.data.tokens.refreshToken, prepared.body.data.recibo,
      environment.TT_UPLOAD_RECEIPT_HMAC_KEY_BASE64, storageRoot, process.env.TT_AUTH_TEST_PASSWORD]) {
      assert.equal(serializedLogs.includes(secret), false);
    }
  });
