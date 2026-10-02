import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

import oracledb from "oracledb";

import { createApp } from "../src/app.js";
import { createIdentityService } from "../src/modules/identity/identity-service.js";
import { createOracleIdentityRepository } from "../src/modules/identity/oracle-identity-repository.js";
import { createPasswordService } from "../src/modules/identity/passwords.js";
import { createTokenService } from "../src/modules/identity/tokens.js";
import { createOracleCustomerVehicleQueries } from "../src/modules/customers-vehicles/oracle-customer-vehicle-queries.js";
import { createOracleCustomerVehicleCommands } from "../src/modules/customers-vehicles/oracle-customer-vehicle-commands.js";
import { createOracleOrderQueries } from "../src/modules/service-orders/oracle-order-queries.js";
import { createOraclePoolManager } from "../src/platform/oracle-pool.js";
import { createOpaqueCursorCodec } from "../src/platform/operational-query-contract.js";
import { loadAuthConfig } from "../src/platform/config.js";

const require = createRequire(import.meta.url);
const { createApiClient } = require("../../mobile/src/api/client.cjs");
const { createCommandIntent } = require("../../mobile/src/api/commandIntent.cjs");
const { customerBody, vehicleRegistrationBody } = require("../../mobile/src/features/customers-vehicles/customerVehicleForms.cjs");

const QR_BASE = "https://taller.example";

test("C01-C05, V01-V08 real Oracle: A/R authority, idempotency, T24/T10 atomicity and invariants", {
  skip: process.env.TT_RUN_CUSTOMER_VEHICLE_ORACLE_INTEGRATION !== "1", timeout: 180000,
}, async (t) => {
  const schema = process.env.TT_ORACLE_SCHEMA;
  const owner = await oracledb.getConnection({ user: process.env.TT_DB_USER,
    password: process.env.TT_DB_PASSWORD, connectString: process.env.TT_ORACLE_CONNECT_STRING });
  t.after(() => owner.close());
  const poolManager = createOraclePoolManager({ driver: oracledb, config: {
    user: process.env.TT_ORACLE_USER, password: process.env.TT_ORACLE_PASSWORD,
    connectString: process.env.TT_ORACLE_CONNECT_STRING, poolMin: 0, poolMax: 8,
    poolIncrement: 1, queueTimeout: 10000, poolTimeout: 60,
  } });
  await poolManager.initialize(); t.after(() => poolManager.close());
  const passwords = createPasswordService();
  const password = randomBytes(24).toString("base64url");
  const hash = await passwords.hash(password);
  for (const [login, roles] of [["admin.cv", ["ADMINISTRADOR"]], ["recep.cv", ["RECEPCIONISTA"]],
    ["mech.cv", ["MECANICO"]], ["inv.cv", ["INVENTARIO"]]]) {
    await owner.execute(`BEGIN pkg_identidad_bootstrap.crear_usuario_interno(:login,:login,:hash,:roles,:id); END;`,
      { login, hash, roles: JSON.stringify(roles), id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } });
  }
  await owner.commit();
  const config = loadAuthConfig({ TT_AUTH_SIGNING_KEY_BASE64: randomBytes(32).toString("base64"),
    TT_AUTH_ISSUER: "cv-test", TT_AUTH_AUDIENCE: "cv-test", TT_AUTH_LOGIN_MAX_ATTEMPTS: "100" });
  const identityService = await createIdentityService({
    repository: createOracleIdentityRepository({ poolManager, schema }), passwordService: passwords,
    tokenService: createTokenService({ config }), authConfig: config });
  const logs = [];
  const app = createApp({ identityService,
    customerVehicleQueries: createOracleCustomerVehicleQueries({ poolManager, schema }),
    customerVehicleCommands: createOracleCustomerVehicleCommands({ poolManager, schema, qrPublicBaseUrl: QR_BASE }),
    orderQueries: createOracleOrderQueries({ poolManager, schema }),
    cursorCodec: createOpaqueCursorCodec({ hmacKey: config.signingKey }),
    logger: { error: (data) => logs.push(data) } });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const tokens = [];
  async function request(path, { token, body, method = body === undefined ? "GET" : "POST", key = randomUUID() } = {}) {
    const response = await fetch(base + path, { method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(body !== undefined && method === "POST" ? { "Idempotency-Key": key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = response.status === 204 ? {} : await response.json();
    return { status: response.status, location: response.headers.get("location"), ...payload };
  }
  async function login(name) {
    const result = await request("/acceso/sesiones", { body: { login: name, password } });
    assert.equal(result.status, 201, JSON.stringify(result));
    tokens.push(result.data.tokens.accessToken);
    return { token: result.data.tokens.accessToken, id: result.data.acceso.usuarioId };
  }
  const admin = await login("admin.cv");
  const recep = await login("recep.cv");
  const mech = await login("mech.cv");
  const inv = await login("inv.cv");
  const scalar = async (sql, binds = {}) => (await owner.execute(sql, binds)).rows[0][0];
  const emittedTokens = [];

  let customerId; let secondCustomerId; let vehicleId; let firstQrId;

  await t.test("C02/C03/C01 by R and A; profile without account; replay and key reuse", async () => {
    const body = { nombre: "Cliente Real TT-026", telefono: "5555 0101", email: "real@tt026.test" };
    const key = randomUUID();
    const pair = await Promise.all([1, 2].map(() => request("/interno/clientes", { token: recep.token, body, key })));
    for (const r of pair) assert.equal(r.status, 201, JSON.stringify(r));
    assert.deepEqual(pair.map((r) => r.meta.repetido).sort(), [false, true]);
    assert.equal(pair[0].data.clienteId, pair[1].data.clienteId);
    customerId = pair[0].data.clienteId;
    assert.match(customerId, /^[1-9][0-9]*$/);
    assert.equal(pair[0].location, `/api/v1/interno/clientes/${customerId}`);
    assert.deepEqual(pair[0].data, { clienteId: customerId, version: "1" });
    const reused = await request("/interno/clientes", { token: recep.token, body: { ...body, nombre: "Otro" }, key });
    assert.equal(reused.status, 409); assert.equal(reused.error.code, "CLAVE_REUTILIZADA");
    assert.equal(await scalar("select count(*) from cliente where nombre='Cliente Real TT-026'"), 1);
    assert.equal(await scalar("select count(*) from usuario where id_cliente=:id", { id: customerId }), 0);
    const detail = await request(`/interno/clientes/${customerId}`, { token: admin.token });
    assert.deepEqual(detail.data, { id: customerId, version: "1", nombre: body.nombre, telefono: body.telefono,
      email: body.email, direccion: null, nit: null, activo: true, accesoDigital: "SIN_CUENTA" });
    const byAdmin = await request("/interno/clientes", { token: admin.token, body: { nombre: "Segundo Cliente TT-026" } });
    assert.equal(byAdmin.status, 201);
    secondCustomerId = byAdmin.data.clienteId;
    const search = await request(`/interno/clientes?q=${encodeURIComponent("real tt-026")}`, { token: recep.token });
    assert.deepEqual(search.data.map(({ id }) => id), [customerId]);
    assert.equal((await request("/interno/clientes/999999999", { token: recep.token })).status, 404);
    assert.equal(await scalar(`select count(*) from auditoria_evento where accion='C02' and identificador_recurso=:id`, { id: customerId }), 1);
  });

  await t.test("M, I and inactive-role sessions are rejected by HTTP and by the Oracle facade", async () => {
    for (const actor of [mech, inv]) {
      assert.equal((await request("/interno/clientes", { token: actor.token, body: { nombre: "X" } })).status, 403);
      assert.equal((await request("/interno/clientes", { token: actor.token })).status, 403);
      assert.equal((await request("/interno/tipos-vehiculo", { token: actor.token })).status, 403);
      assert.equal((await request("/interno/vehiculos", { token: actor.token, body: { vehiculo: {
        tipoVehiculo: "AUTOMOVIL", marca: "X", modelo: "Y" }, propietarioId: customerId, motivoPropiedad: "X" } })).status, 403);
    }
    const mechanicSession = await scalar("select max(id_sesion) from sesion where id_usuario=:id", { id: mech.id });
    await poolManager.withConnection(async (connection) => {
      await assert.rejects(connection.execute(`BEGIN ${schema}.pkg_clientes_vehiculos_http.registrar_cliente(
        :actor,:session,:key,:hash,:correlation,'Intruso',NULL,NULL,NULL,NULL,:r,:rep,:c,:f); END;`, {
        actor: mech.id, session: mechanicSession, key: randomUUID(), hash: randomBytes(32), correlation: randomUUID(),
        r: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 }, rep: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        c: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 40 }, f: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 40 },
      }), /ACCION_NO_PERMITIDA/);
    });
    assert.equal(await scalar("select count(*) from cliente where nombre='Intruso'"), 0);
  });

  await t.test("C04 versioned update, null erasure and stale version", async () => {
    const path = `/interno/clientes/${customerId}`;
    const updated = await request(path, { token: recep.token, method: "PATCH",
      body: { versionEsperada: "1", cambios: { telefono: null, direccion: "Zona 1" } } });
    assert.equal(updated.status, 200, JSON.stringify(updated));
    assert.equal(updated.data.version, "2"); assert.equal(updated.data.telefono, null);
    assert.equal(updated.data.direccion, "Zona 1"); assert.equal(updated.data.accesoDigital, "SIN_CUENTA");
    const stale = await request(path, { token: admin.token, method: "PATCH", body: { versionEsperada: "1", cambios: { nit: "CF" } } });
    assert.equal(stale.status, 409); assert.equal(stale.error.code, "VERSION_DESACTUALIZADA");
    assert.equal((await request(path, { token: recep.token })).data.nit, null);
    assert.equal(await scalar("select count(*) from usuario where id_cliente=:id", { id: customerId }), 0);
  });

  const vehicle = { tipoVehiculo: "AUTOMOVIL", placa: "p-026abc", vin: "1hgcm82633a004352", marca: "Toyota",
    modelo: "Corolla", anio: 2018, color: "Gris" };

  await t.test("V08 and V02: T24 persists vehicle, one current owner and QR; secret only in first response", async () => {
    const types = await request("/interno/tipos-vehiculo", { token: recep.token });
    assert.deepEqual(types.data.map((row) => row.codigo), ["AUTOMOVIL", "CAMION", "CAMIONETA", "MOTOCICLETA", "OTRO"]);
    const key = randomUUID();
    const body = { vehiculo: vehicle, propietarioId: customerId, motivoPropiedad: "Alta inicial desde recepción" };
    const pair = await Promise.all([1, 2].map(() => request("/interno/vehiculos", { token: recep.token, body, key })));
    for (const r of pair) assert.equal(r.status, 201, JSON.stringify(r));
    const first = pair.find((r) => r.meta.repetido === false);
    const replay = pair.find((r) => r.meta.repetido === true);
    assert.ok(first && replay);
    vehicleId = first.data.vehiculoId; firstQrId = first.data.qr.generacionId;
    assert.equal(first.location, `/api/v1/interno/vehiculos/${vehicleId}`);
    assert.equal(first.data.version, "1"); assert.equal(first.data.qr.estado, "VIGENTE");
    assert.equal(first.data.requiereNuevaEmision, false);
    const url = first.data.emisionQr.urlPublica;
    const match = new RegExp(`^${QR_BASE}/qr/([A-Za-z0-9_-]{43})$`).exec(url);
    assert.ok(match, url); emittedTokens.push(match[1]);
    assert.equal(replay.data.vehiculoId, vehicleId); assert.equal(replay.data.emisionQr, null);
    assert.equal(replay.data.requiereNuevaEmision, true); assert.equal(replay.data.propiedadId, first.data.propiedadId);
    const storedHash = (await owner.execute("select token_hash from qr_token where id_qr=:id", { id: firstQrId })).rows[0][0];
    assert.deepEqual(storedHash, createHash("sha256").update(Buffer.from(match[1], "base64url")).digest());
    const stored = await owner.execute("select dbms_lob.substr(resultado_minimo,4000) from comando where id_comando=:id",
      { id: first.meta.comandoId });
    assert.equal(stored.rows[0][0].includes(match[1]), false);
    assert.equal(await scalar("select count(*) from vehiculo where placa='P-026ABC'"), 1);
    assert.equal(await scalar("select vin from vehiculo where id_vehiculo=:id", { id: vehicleId }), "1HGCM82633A004352");
    assert.equal(await scalar("select count(*) from propiedad_vehiculo where id_vehiculo=:id and hasta_en is null", { id: vehicleId }), 1);
    assert.equal(await scalar("select count(*) from qr_token where id_vehiculo=:id and revocado_en is null", { id: vehicleId }), 1);
    const reused = await request("/interno/vehiculos", { token: recep.token, key,
      body: { ...body, motivoPropiedad: "Otro motivo" } });
    assert.equal(reused.status, 409); assert.equal(reused.error.code, "CLAVE_REUTILIZADA");
  });

  await t.test("V03/V01/V05 read the persisted owner, QR state and single history period without secrets", async () => {
    const detail = await request(`/interno/vehiculos/${vehicleId}`, { token: admin.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.propiedadActual.clienteId, customerId);
    assert.equal(detail.data.propiedadActual.nombreCliente, "Cliente Real TT-026");
    assert.deepEqual({ ...detail.data.qr, emitidoEn: undefined }, { generacionId: firstQrId, estado: "VIGENTE", emitidoEn: undefined, expiraEn: null });
    assert.equal(detail.data.ordenActivaId, null);
    assert.equal(JSON.stringify(detail).includes(emittedTokens[0]), false);
    const byOwner = await request(`/interno/vehiculos?clienteId=${customerId}`, { token: recep.token });
    assert.deepEqual(byOwner.data.map(({ id }) => id), [vehicleId]);
    const bySearch = await request("/interno/vehiculos?q=p-026", { token: recep.token });
    assert.deepEqual(bySearch.data.map(({ id }) => id), [vehicleId]);
    const history = await request(`/interno/vehiculos/${vehicleId}/propiedades`, { token: recep.token });
    assert.equal(history.data.length, 1);
    assert.equal(history.data[0].clienteId, customerId); assert.equal(history.data[0].hastaEn, null);
    assert.equal((await request("/interno/vehiculos/999999999/propiedades", { token: recep.token })).status, 404);
  });

  await t.test("V02 domain failures: duplicates, owner, type; absent identifiers are valid", async () => {
    const register = (vehiculo, propietarioId = customerId) => request("/interno/vehiculos", { token: recep.token,
      body: { vehiculo, propietarioId, motivoPropiedad: "Alta" } });
    const duplicatePlate = await register({ ...vehicle, placa: " P-026ABC ", vin: null });
    assert.equal(duplicatePlate.status, 409); assert.equal(duplicatePlate.error.code, "REFERENCIA_DUPLICADA");
    assert.equal(duplicatePlate.error.fields[0].path, "/vehiculo/placa");
    const duplicateVin = await register({ ...vehicle, placa: null });
    assert.equal(duplicateVin.status, 409); assert.equal(duplicateVin.error.fields[0].path, "/vehiculo/vin");
    const missingOwner = await register({ ...vehicle, placa: "NEW-1", vin: null }, "999999999");
    assert.equal(missingOwner.status, 422); assert.equal(missingOwner.error.code, "VALIDACION_DOMINIO");
    assert.equal(missingOwner.error.fields[0].path, "/propietarioId");
    const unknownType = await register({ ...vehicle, tipoVehiculo: "NAVE", placa: "NEW-2", vin: null });
    assert.equal(unknownType.status, 422); assert.equal(unknownType.error.fields[0].path, "/vehiculo/tipoVehiculo");
    await owner.execute("update tipo_vehiculo set activo=0 where codigo_tipo='CAMION'"); await owner.commit();
    const inactiveType = await register({ ...vehicle, tipoVehiculo: "CAMION", placa: "NEW-3", vin: null });
    assert.equal(inactiveType.status, 422); assert.equal(inactiveType.error.fields[0].path, "/vehiculo/tipoVehiculo");
    assert.equal((await request("/interno/tipos-vehiculo", { token: recep.token })).data.some((row) => row.codigo === "CAMION"), false);
    assert.equal((await request("/interno/tipos-vehiculo?incluirInactivos=true", { token: recep.token })).data
      .find((row) => row.codigo === "CAMION").activo, false);
    await owner.execute("update tipo_vehiculo set activo=1 where codigo_tipo='CAMION'"); await owner.commit();
    // Two independent intentions for the same plate race on the unique constraint: one wins.
    const race = await Promise.all(["race-026", "RACE-026 "].map((placa) => register({ ...vehicle, placa, vin: null })));
    assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await scalar("select count(*) from vehiculo where placa='RACE-026'"), 1);
    const withoutIdentifiers = await register({ tipoVehiculo: "OTRO", marca: "Artesanal", modelo: "Remolque" }, secondCustomerId);
    assert.equal(withoutIdentifiers.status, 201, JSON.stringify(withoutIdentifiers));
    assert.equal(await scalar("select count(*) from vehiculo where placa in ('NEW-1','NEW-2','NEW-3')"), 0);
    assert.equal(await scalar("select count(*) from comando where tipo_operacion='REGISTRAR_VEHICULO' and resultado_minimo is null"), 0);
  });

  await t.test("V02 failure after the vehicle insert rolls back vehicle, ownership, QR, command and audit", async () => {
    const counts = async () => Promise.all(["vehiculo", "propiedad_vehiculo", "qr_token", "comando", "auditoria_evento"]
      .map((table) => scalar(`select count(*) from ${table}`)));
    for (const trigger of [
      "CREATE OR REPLACE TRIGGER test_cv_qr BEFORE INSERT ON qr_token FOR EACH ROW BEGIN RAISE_APPLICATION_ERROR(-20999,'TEST_FAILURE'); END;",
      "CREATE OR REPLACE TRIGGER test_cv_qr BEFORE INSERT ON auditoria_evento FOR EACH ROW BEGIN IF :new.accion='REGISTRAR_VEHICULO' THEN RAISE_APPLICATION_ERROR(-20999,'TEST_FAILURE'); END IF; END;",
    ]) {
      await owner.execute(trigger);
      const before = await counts();
      const key = randomUUID();
      const failed = await request("/interno/vehiculos", { token: recep.token, key,
        body: { vehiculo: { ...vehicle, placa: "ROLLBACK-1", vin: null }, propietarioId: customerId, motivoPropiedad: "Atomicidad" } });
      assert.equal(failed.status, 500); assert.equal(failed.error.resultado, "DESCONOCIDO");
      assert.deepEqual(await counts(), before);
      assert.equal(await scalar("select count(*) from comando where clave_idempotencia=:key", { key }), 0);
      await owner.execute("DROP TRIGGER test_cv_qr");
      // Same key after the failure is a fresh intention: nothing was confirmed.
      const retried = await request("/interno/vehiculos", { token: recep.token, key,
        body: { vehiculo: { ...vehicle, placa: "ROLLBACK-1", vin: null }, propietarioId: customerId, motivoPropiedad: "Atomicidad" } });
      assert.equal(retried.status, 201); assert.equal(retried.meta.repetido, false);
      const retriedId = retried.data.vehiculoId;
      await request(`/interno/vehiculos/${retriedId}`, { token: recep.token, method: "PATCH",
        body: { versionEsperada: "1", cambios: { placa: null } } });
    }
  });

  await t.test("V04 versioned descriptors, normalized duplicate detection; no owner/QR changes", async () => {
    const path = `/interno/vehiculos/${vehicleId}`;
    const updated = await request(path, { token: recep.token, method: "PATCH",
      body: { versionEsperada: "1", cambios: { color: "Rojo", anio: null } } });
    assert.equal(updated.status, 200, JSON.stringify(updated));
    assert.equal(updated.data.version, "2"); assert.equal(updated.data.color, "Rojo"); assert.equal(updated.data.anio, null);
    assert.equal(updated.data.propiedadActual.clienteId, customerId); assert.equal(updated.data.qr.generacionId, firstQrId);
    const stale = await request(path, { token: recep.token, method: "PATCH", body: { versionEsperada: "1", cambios: { color: "Azul" } } });
    assert.equal(stale.error.code, "VERSION_DESACTUALIZADA");
    const other = await request("/interno/vehiculos", { token: recep.token, body: { vehiculo: { tipoVehiculo: "MOTOCICLETA",
      placa: "M-026", marca: "Honda", modelo: "CB" }, propietarioId: customerId, motivoPropiedad: "Alta" } });
    assert.equal(other.status, 201);
    const duplicate = await request(`/interno/vehiculos/${other.data.vehiculoId}`, { token: recep.token, method: "PATCH",
      body: { versionEsperada: "1", cambios: { placa: "p-026abc" } } });
    assert.equal(duplicate.status, 409); assert.equal(duplicate.error.fields[0].path, "/cambios/placa");
  });

  await t.test("V06 transfer: contiguous periods, QR rotation, replay, stale owner, same destination, race", async () => {
    const current = (await request(`/interno/vehiculos/${vehicleId}`, { token: recep.token })).data;
    const body = { propiedadEsperadaId: current.propiedadActual.id, propietarioEsperadoId: customerId,
      nuevoPropietarioId: secondCustomerId, motivo: "Compraventa" };
    const same = await request(`/interno/vehiculos/${vehicleId}/transferir-propietario`, { token: recep.token,
      body: { ...body, nuevoPropietarioId: customerId } });
    assert.equal(same.status, 422); assert.equal(same.error.fields[0].path, "/nuevoPropietarioId");
    const path = `/interno/vehiculos/${vehicleId}/transferir-propietario`;
    const race = await Promise.all([randomUUID(), randomUUID()].map((key) => request(path, { token: recep.token, body, key })));
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    const winner = race.find((r) => r.status === 200);
    assert.equal(race.find((r) => r.status === 409).error.code, "PROPIEDAD_CAMBIADA");
    assert.equal(winner.data.propiedadAnteriorId, current.propiedadActual.id);
    assert.notEqual(winner.data.qr.generacionId, firstQrId);
    assert.match(winner.data.emisionQr.urlPublica, /\/qr\/[A-Za-z0-9_-]{43}$/);
    emittedTokens.push(winner.data.emisionQr.urlPublica.split("/").at(-1));
    const replayKey = randomUUID();
    const next = { ...body, propiedadEsperadaId: winner.data.propiedadActualId, propietarioEsperadoId: secondCustomerId,
      nuevoPropietarioId: customerId, motivo: "Devolución" };
    const back = await request(path, { token: admin.token, body: next, key: replayKey });
    assert.equal(back.status, 200, JSON.stringify(back));
    const replay = await request(path, { token: admin.token, body: next, key: replayKey });
    assert.equal(replay.meta.repetido, true); assert.equal(replay.data.emisionQr, null); assert.equal(replay.data.requiereNuevaEmision, true);
    const history = await request(`/interno/vehiculos/${vehicleId}/propiedades`, { token: recep.token });
    assert.deepEqual(history.data.map((row) => row.clienteId), [customerId, secondCustomerId, customerId]);
    assert.equal(history.data.filter((row) => row.hastaEn === null).length, 1);
    assert.equal(history.data[1].desdeEn, history.data[2].hastaEn);
    assert.equal(await scalar("select count(*) from qr_token where id_vehiculo=:id", { id: vehicleId }), 3);
    assert.equal(await scalar("select count(*) from qr_token where id_vehiculo=:id and revocado_en is null", { id: vehicleId }), 1);
  });

  await t.test("C05/V07 deactivate with version; inactive masters reject new relations; account untouched", async () => {
    const vehicleNow = (await request(`/interno/vehiculos/${vehicleId}`, { token: recep.token })).data;
    const key = randomUUID();
    const body = { versionEsperada: vehicleNow.version, motivo: "Fuera de circulación" };
    const off = await request(`/interno/vehiculos/${vehicleId}/desactivar`, { token: recep.token, body, key });
    assert.equal(off.status, 200); assert.deepEqual(off.data, { vehiculoId: vehicleId, version: String(Number(vehicleNow.version) + 1), activo: false });
    assert.equal((await request(`/interno/vehiculos/${vehicleId}/desactivar`, { token: recep.token, body, key })).meta.repetido, true);
    const again = await request(`/interno/vehiculos/${vehicleId}/desactivar`, { token: recep.token,
      body: { versionEsperada: off.data.version, motivo: "Otra" } });
    assert.equal(again.error.code, "ESTADO_INCOMPATIBLE");
    const afterOff = (await request(`/interno/vehiculos/${vehicleId}`, { token: recep.token })).data;
    assert.equal(afterOff.qr.estado, "VIGENTE"); assert.equal(afterOff.propiedadActual.clienteId, customerId);
    const customerNow = (await request(`/interno/clientes/${secondCustomerId}`, { token: recep.token })).data;
    const deactivated = await request(`/interno/clientes/${secondCustomerId}/desactivar`, { token: admin.token,
      body: { versionEsperada: customerNow.version, motivo: "Solicitud del cliente" } });
    assert.equal(deactivated.status, 200); assert.equal(deactivated.data.activo, false);
    const rejected = await request("/interno/vehiculos", { token: recep.token, body: { vehiculo: { tipoVehiculo: "OTRO",
      marca: "X", modelo: "Y" }, propietarioId: secondCustomerId, motivoPropiedad: "Alta" } });
    assert.equal(rejected.status, 422); assert.equal(rejected.error.fields[0].path, "/propietarioId");
    assert.equal((await request(`/interno/vehiculos?clienteId=${secondCustomerId}&activo=true`, { token: recep.token })).data.length, 1,
      "the vehicle registered without identifiers keeps its inactive owner and history");
  });

  await t.test("mobile client shapes C02 + V02 through real HTTP with one retained intent each", async () => {
    let saved = null;
    const mobile = createApiClient({ baseUrl: base, fetchImpl: fetch,
      store: { read: async () => saved, write: async (value) => { saved = value; }, clear: async () => { saved = null; } } });
    await mobile.login("recep.cv", password);
    const intent = createCommandIntent({ request: mobile.request, uuid: randomUUID });
    const created = await intent.run("/interno/clientes",
      customerBody({ nombre: " Cliente Móvil ", telefono: "", email: "", direccion: "", nit: "" }));
    const detail = (await mobile.request(`/interno/clientes/${created.clienteId}`)).data;
    assert.equal(detail.nombre, "Cliente Móvil"); assert.equal(detail.telefono, null);
    const registered = await createCommandIntent({ request: mobile.request, uuid: randomUUID }).run("/interno/vehiculos",
      vehicleRegistrationBody({ ownerId: created.clienteId, tipoVehiculo: "CAMIONETA", placa: "mob-026",
        vin: "", marca: "Nissan", modelo: "Frontier", anio: "2021", color: "", motivoPropiedad: "Alta desde teléfono" }));
    assert.equal(registered.requiereNuevaEmision, false);
    const vehicleDetail = (await mobile.request(`/interno/vehiculos/${registered.vehiculoId}`)).data;
    assert.equal(vehicleDetail.placa, "MOB-026"); assert.equal(vehicleDetail.anio, 2021);
    assert.equal(vehicleDetail.propiedadActual.clienteId, created.clienteId);
    emittedTokens.push(registered.emisionQr.urlPublica.split("/").at(-1));
    await mobile.logout();
  });

  await t.test("runtime privilege stays bounded; no unfinished commands; no secrets stored or logged", async () => {
    await poolManager.withConnection(async (connection) => {
      await assert.rejects(connection.execute(`INSERT INTO ${schema}.cliente (nombre, activo, creado_en, creado_por,
        actualizado_en, actualizado_por, version_fila) VALUES ('X',1,SYSTIMESTAMP,1,SYSTIMESTAMP,1,1)`));
      await assert.rejects(connection.execute(`UPDATE ${schema}.propiedad_vehiculo SET hasta_en=NULL`));
      await assert.rejects(connection.execute(`SELECT token_hash FROM ${schema}.qr_token`));
    });
    assert.equal(await scalar("select count(*) from comando where resultado_codigo=102 or resultado_minimo is null"), 0);
    assert.equal(await scalar(`select count(*) from (select id_vehiculo from propiedad_vehiculo where hasta_en is null
      group by id_vehiculo having count(*)<>1)`), 0);
    assert.equal(await scalar("select count(*) from vehiculo v where not exists (select 1 from propiedad_vehiculo p where p.id_vehiculo=v.id_vehiculo and p.hasta_en is null)"), 0);
    const stored = JSON.stringify((await owner.execute(`select dbms_lob.substr(resultado_minimo,4000) from comando
      union all select dbms_lob.substr(cambios,4000) from auditoria_evento`)).rows);
    for (const value of emittedTokens) {
      assert.equal(stored.includes(value), false);
      assert.equal(JSON.stringify(logs).includes(value), false);
    }
    for (const value of tokens) assert.equal(JSON.stringify(logs).includes(value), false);
  });
});
