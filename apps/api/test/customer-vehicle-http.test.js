import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import test from "node:test";

import { createApp } from "../src/app.js";
import { createOpaqueCursorCodec } from "../src/platform/operational-query-contract.js";
import { loadQrPublicConfig } from "../src/platform/config.js";
import { createOracleCustomerVehicleCommands } from "../src/modules/customers-vehicles/oracle-customer-vehicle-commands.js";

const token = "header.payload.signature";
const key = "12345678-1234-4567-89ab-1234567890ab";
const customer = { id: "5", version: "2", nombre: "Ana", telefono: null, email: null,
  direccion: null, nit: null, activo: true, accesoDigital: "SIN_CUENTA" };

async function fixture(t, roles = ["RECEPCIONISTA"]) {
  let access = { userId: "7", sessionId: "8", type: "INTERNO", roles };
  const calls = [];
  const queries = {
    async getCustomer(input) { calls.push(["getCustomer", input]); return input.customerId === "5" ? customer : null; },
    async getVehicle(input) { calls.push(["getVehicle", input]); return { id: input.vehicleId, version: "3" }; },
    async listProperties(input) { calls.push(["properties", input]);
      return [{ id: "11", clienteId: "5", nombreCliente: "Ana", desdeEn: "2026-09-30T00:00:00.000000Z",
        hastaEn: null, motivo: "Alta", _position: { date: "2026-09-30T00:00:00.000000Z", id: "11" } }]; },
    async listVehicleTypes(input) { calls.push(["types", input]); return [{ codigo: "AUTOMOVIL", nombre: "Automovil", activo: true }]; },
    async listCustomers() { return []; }, async listVehicles() { return []; },
  };
  const commands = new Proxy({}, { get: (_target, name) => async (input) => {
    calls.push([name, input]);
    if (name === "updateCustomer" || name === "updateVehicle") return "3";
    return { data: { clienteId: "5", vehiculoId: "9", version: "1" }, repeated: false,
      commandId: "44", confirmedAt: "2026-09-30T00:00:00.000000Z" };
  } });
  const app = createApp({ identityService: { authenticate: async () => access },
    customerVehicleQueries: queries, customerVehicleCommands: commands, orderQueries: { },
    cursorCodec: createOpaqueCursorCodec({ hmacKey: Buffer.alloc(32, 3) }), logger: { error() {} } });
  const server = app.listen(0); await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function request(path, { method = "GET", body, idempotency = true } = {}) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(body !== undefined && idempotency ? { "Idempotency-Key": key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, location: response.headers.get("location"), ...(await response.json()) };
  }
  return { request, calls, setRoles(next) { access = { ...access, roles: next }; } };
}

const vehicleBody = { vehiculo: { tipoVehiculo: "AUTOMOVIL", placa: " p123abc ", marca: "Toyota", modelo: "Corolla" },
  propietarioId: "5", motivoPropiedad: "Alta inicial" };

test("C02 registers a profile without account fields and derives actor, key and Location", async (t) => {
  const { request, calls } = await fixture(t);
  const created = await request("/interno/clientes", { method: "POST", body: { nombre: "  Ana López ", telefono: "5555-0000" } });
  assert.equal(created.status, 201);
  assert.equal(created.location, "/api/v1/interno/clientes/5");
  assert.equal(created.meta.comandoId, "44");
  const [, input] = calls.at(-1);
  assert.deepEqual(input.profile, { nombre: "Ana López", telefono: "5555-0000", email: null, direccion: null, nit: null });
  assert.equal(input.actorId, "7"); assert.equal(input.sessionId, "8"); assert.equal(input.key, key);
  for (const body of [{ nombre: "Ana", login: "ana" }, { nombre: "Ana", password: "secret-password" },
    { nombre: "   " }, { nombre: "Ana", email: "" }, { nombre: "x".repeat(201) }, { telefono: "1" }, { nombre: "Ana", activo: false }]) {
    const rejected = await request("/interno/clientes", { method: "POST", body });
    assert.equal(rejected.status, 400, JSON.stringify(body));
    assert.equal(rejected.error.fields.length, 1);
  }
  assert.equal((await request("/interno/clientes", { method: "POST", body: { nombre: "Ana" }, idempotency: false })).error.code, "CLAVE_REQUERIDA");
});

test("C03/C04 read and patch with version, null erasure and closed change set", async (t) => {
  const { request, calls } = await fixture(t);
  assert.equal((await request("/interno/clientes/5")).data.nombre, "Ana");
  assert.equal((await request("/interno/clientes/6")).status, 404);
  const patched = await request("/interno/clientes/5", { method: "PATCH",
    body: { versionEsperada: "2", cambios: { telefono: null, email: "ana@example.test" } } });
  assert.equal(patched.status, 200);
  const update = calls.find(([name]) => name === "updateCustomer")[1];
  assert.deepEqual(update.changes, { telefono: null, email: "ana@example.test" });
  assert.equal(update.version, "2");
  for (const body of [{ versionEsperada: "2", cambios: {} }, { versionEsperada: "2", cambios: { nombre: null } },
    { versionEsperada: "0", cambios: { nit: "1" } }, { versionEsperada: "2", cambios: { accesoDigital: "ACTIVO" } },
    { cambios: { nit: "1" } }]) {
    assert.equal((await request("/interno/clientes/5", { method: "PATCH", body })).status, 400, JSON.stringify(body));
  }
});

test("V02 sends one complete intent with normalized identifiers; mobile cannot send authority", async (t) => {
  const { request, calls } = await fixture(t);
  const created = await request("/interno/vehiculos", { method: "POST", body: vehicleBody });
  assert.equal(created.status, 201);
  assert.equal(created.location, "/api/v1/interno/vehiculos/9");
  const input = calls.at(-1)[1];
  assert.deepEqual(input.vehicle, { tipoVehiculo: "AUTOMOVIL", placa: "P123ABC", vin: null, marca: "Toyota",
    modelo: "Corolla", anio: null, color: null });
  assert.equal(input.ownerId, "5");
  for (const body of [
    { ...vehicleBody, qr: "x" }, { ...vehicleBody, propietarioId: 5 },
    { ...vehicleBody, vehiculo: { ...vehicleBody.vehiculo, anio: 0 } },
    { ...vehicleBody, vehiculo: { ...vehicleBody.vehiculo, anio: 2020.5 } },
    { ...vehicleBody, vehiculo: { ...vehicleBody.vehiculo, propietarioId: "5" } },
    { ...vehicleBody, vehiculo: { ...vehicleBody.vehiculo, activo: true } },
    { ...vehicleBody, motivoPropiedad: " " },
  ]) assert.equal((await request("/interno/vehiculos", { method: "POST", body })).status, 400, JSON.stringify(body));
  // Absent plate and VIN are valid while G-05 does not require either identifier.
  const noIdentifiers = await request("/interno/vehiculos", { method: "POST",
    body: { ...vehicleBody, vehiculo: { tipoVehiculo: "OTRO", marca: "Artesanal", modelo: "Remolque" } } });
  assert.equal(noIdentifiers.status, 201);
});

test("V04 cannot change owner, QR or order state; V05/V06/V07/V08 route with bound inputs", async (t) => {
  const { request, calls } = await fixture(t);
  for (const field of ["propietarioId", "qr", "ordenActivaId", "activo", "version"]) {
    assert.equal((await request("/interno/vehiculos/9", { method: "PATCH",
      body: { versionEsperada: "1", cambios: { [field]: "1" } } })).status, 400, field);
  }
  const patched = await request("/interno/vehiculos/9", { method: "PATCH",
    body: { versionEsperada: "1", cambios: { vin: "abc123", color: null } } });
  assert.equal(patched.status, 200);
  assert.deepEqual(calls.find(([name]) => name === "updateVehicle")[1].changes, { vin: "ABC123", color: null });
  const history = await request("/interno/vehiculos/9/propiedades?limite=1");
  assert.equal(history.status, 200); assert.equal(history.data[0].id, "11");
  assert.equal((await request("/interno/vehiculos/9/propiedades?clienteId=1")).status, 400);
  assert.equal((await request("/interno/tipos-vehiculo")).data[0].codigo, "AUTOMOVIL");
  assert.equal((await request("/interno/tipos-vehiculo?incluirInactivos=true")).status, 200);
  assert.equal(calls.at(-1)[1].includeInactive, true);
  const transfer = { propiedadEsperadaId: "11", propietarioEsperadoId: "5", nuevoPropietarioId: "6", motivo: "Venta" };
  assert.equal((await request("/interno/vehiculos/9/transferir-propietario", { method: "POST", body: transfer })).status, 200);
  assert.deepEqual(calls.at(-1)[1].transfer, { expectedPropertyId: "11", expectedOwnerId: "5", newOwnerId: "6", reason: "Venta" });
  assert.equal((await request("/interno/vehiculos/9/desactivar", { method: "POST",
    body: { versionEsperada: "3", motivo: "Fuera de servicio" } })).status, 200);
  assert.equal(calls.at(-1)[1].operation, "V07");
  assert.equal((await request("/interno/clientes/5/desactivar", { method: "POST",
    body: { versionEsperada: "2", motivo: "Solicitud" } })).status, 200);
  assert.equal(calls.at(-1)[1].operation, "C05");
});

test("only A/R reach customer/vehicle maintenance; no operational inheritance to other roles", async (t) => {
  const value = await fixture(t, ["ADMINISTRADOR"]);
  assert.equal((await value.request("/interno/clientes", { method: "POST", body: { nombre: "Ana" } })).status, 201);
  for (const roles of [["MECANICO"], ["INVENTARIO"], ["CLIENTE"], []]) {
    value.setRoles(roles);
    const before = value.calls.length;
    for (const [path, method, body] of [["/interno/clientes", "POST", { nombre: "Ana" }], ["/interno/clientes/5", "GET"],
      ["/interno/vehiculos", "POST", vehicleBody], ["/interno/tipos-vehiculo", "GET"],
      ["/interno/vehiculos/9/propiedades", "GET"]]) {
      const response = await value.request(path, { method, body });
      assert.equal(response.status, 403, `${roles} ${path}`);
      assert.equal(response.error.code, "ACCION_NO_PERMITIDA");
    }
    assert.equal(value.calls.length, before, "a forbidden actor must not reach Oracle");
  }
});

test("V02/V06 emission: secret only in first success, only its hash reaches Oracle, replay needs new emission", async () => {
  const secret = Buffer.alloc(32, 9);
  const stored = { vehiculoId: "9", propiedadId: "11", qrId: "13", version: "1",
    qr: { generacionId: "13", estado: "VIGENTE", emitidoEn: "2026-09-30T00:00:00.000000Z", expiraEn: null } };
  const executions = [];
  let repeated = 0;
  const connection = {
    async execute(sql, binds) { executions.push({ sql, binds });
      return { outBinds: { result: JSON.stringify(stored), repeated, commandId: "44", confirmedAt: "2026-09-30T00:00:00.000000Z" } }; },
    async commit() {}, async rollback() {}, async close() {},
  };
  const commands = createOracleCustomerVehicleCommands({ poolManager: { getConnection: async () => connection },
    schema: "TT_OWNER", qrPublicBaseUrl: "https://taller.example", randomSecret: () => secret,
    driver: { BIND_OUT: 3003, STRING: 2001, NUMBER: 2010 } });
  const input = { actorId: "7", sessionId: "8", key, correlationId: key, ownerId: "5", reason: "Alta",
    vehicle: { tipoVehiculo: "AUTOMOVIL", placa: "P1", vin: null, marca: "M", modelo: "N", anio: null, color: null } };
  const first = await commands.registerVehicle(input);
  const tokenValue = secret.toString("base64url");
  assert.equal(tokenValue.length, 43);
  assert.deepEqual(first.data, { vehiculoId: "9", propiedadId: "11", version: "1", qr: stored.qr,
    emisionQr: { generacionId: "13", urlPublica: `https://taller.example/qr/${tokenValue}`,
      emitidoEn: stored.qr.emitidoEn, expiraEn: null }, requiereNuevaEmision: false });
  const binds = executions[0].binds;
  assert.deepEqual(binds.tokenHash, createHash("sha256").update(secret).digest());
  assert.equal(JSON.stringify(executions).includes(tokenValue), false);
  repeated = 1;
  const replay = await commands.registerVehicle(input);
  assert.equal(replay.data.emisionQr, null); assert.equal(replay.data.requiereNuevaEmision, true);
  assert.equal(replay.repeated, true);
  assert.deepEqual(executions[1].binds.hash, binds.hash, "same intent hashes identically without the secret");
});

test("facade field pointers become contract field errors", async () => {
  const connection = { async execute() { throw new Error("ORA-20004: REFERENCIA_DUPLICADA /vehiculo/placa\nORA-06512: at line 1"); },
    async commit() {}, async rollback() {}, async close() {} };
  const commands = createOracleCustomerVehicleCommands({ poolManager: { getConnection: async () => connection },
    schema: "TT_OWNER", qrPublicBaseUrl: "https://taller.example", driver: { BIND_OUT: 1, STRING: 2, NUMBER: 3 } });
  await assert.rejects(commands.registerVehicle({ vehicle: { tipoVehiculo: "OTRO", placa: "P", vin: null, marca: "M",
    modelo: "N", anio: null, color: null } }), (error) => error.code === "REFERENCIA_DUPLICADA"
    && error.fields[0].path === "/vehiculo/placa");
});

test("QR public base requires HTTPS except loopback development", () => {
  assert.deepEqual(loadQrPublicConfig({ TT_QR_PUBLIC_BASE_URL: "https://taller.example/" }), { publicBaseUrl: "https://taller.example" });
  assert.deepEqual(loadQrPublicConfig({ TT_QR_PUBLIC_BASE_URL: "http://127.0.0.1:3000" }), { publicBaseUrl: "http://127.0.0.1:3000" });
  for (const value of ["http://192.168.1.5:3000", "https://taller.example/?a=1", "ftp://x", "taller", ""]) {
    assert.throws(() => loadQrPublicConfig({ TT_QR_PUBLIC_BASE_URL: value }), /TT_QR_PUBLIC_BASE_URL/);
  }
});
