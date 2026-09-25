import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createApp } from "../src/app.js";
import { createOpaqueCursorCodec } from "../src/platform/operational-query-contract.js";

const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature";

function customer(id) {
  return {
    id: String(id), version: "1", nombre: `Cliente ${id}`, telefono: null, email: null,
    direccion: null, nit: null, activo: true, accesoDigital: "SIN_CUENTA",
    _position: { date: `2026-09-12T00:00:${String(id).padStart(2, "0")}.000000Z`, id: String(id) },
  };
}

async function fixture(t, roles = ["RECEPCIONISTA"]) {
  let access = { userId: "91", sessionId: "92", roles };
  const calls = [];
  const customerVehicleQueries = {
    async listCustomers(input) { calls.push(["customers", input]); return [customer(3), customer(2), customer(1)]; },
    async listVehicles(input) { calls.push(["vehicles", input]); return []; },
    async getVehicle(input) { calls.push(["vehicle", input]); return input.vehicleId === "7" ? { id: "7" } : null; },
  };
  const orderQueries = {
    async listOrders(input) { calls.push(["orders", input]); return []; },
    async getOrder(input) { calls.push(["order", input]); return input.orderId === "8" ? { id: "8", projection: input.view } : null; },
  };
  const app = createApp({
    identityService: { authenticate: async () => access },
    customerVehicleQueries, orderQueries,
    cursorCodec: createOpaqueCursorCodec({ hmacKey: Buffer.alloc(32, 7) }),
    logger: { error() {} },
  });
  const server = app.listen(0); await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const get = (path) => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { get, calls, setAccess(value) { access = value; } };
}

test("C01 applies contract pagination and binds an opaque cursor to filters and actor", async (t) => {
  const fixtureValue = await fixture(t);
  const first = await fixtureValue.get("/interno/clientes?limite=2&q=Cliente&activo=true");
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.deepEqual(body.data.map(({ id }) => id), ["3", "2"]);
  assert.equal(body.page.hayMas, true);
  assert.match(body.page.siguienteCursor, /^v1\./);
  assert.equal(body.page.siguienteCursor.includes("eyJ"), false);

  const next = await fixtureValue.get(`/interno/clientes?limite=2&q=Cliente&activo=true&cursor=${encodeURIComponent(body.page.siguienteCursor)}`);
  assert.equal(next.status, 200);
  assert.deepEqual(fixtureValue.calls.at(-1)[1].after, customer(2)._position);

  const wrongFilter = await fixtureValue.get(`/interno/clientes?limite=2&q=Different&activo=true&cursor=${encodeURIComponent(body.page.siguienteCursor)}`);
  assert.equal(wrongFilter.status, 400);
  assert.equal((await wrongFilter.json()).error.code, "CURSOR_INVALIDO");
});

test("list validation rejects limits, short search, unknown and repeated parameters", async (t) => {
  const { get } = await fixture(t);
  for (const path of [
    "/interno/clientes?limite=0", "/interno/clientes?limite=101", "/interno/clientes?q=x",
    "/interno/clientes?sort=id", "/interno/clientes?activo=true&activo=false",
  ]) {
    const response = await get(path);
    assert.equal(response.status, 400, path);
    assert.equal((await response.json()).error.code, "SOLICITUD_INVALIDA", path);
  }
});

test("C01/V01/V03 require A/R and IDs use the canonical decimal grammar", async (t) => {
  const value = await fixture(t, ["MECANICO"]);
  for (const path of ["/interno/clientes", "/interno/vehiculos", "/interno/vehiculos/7"]) {
    assert.equal((await value.get(path)).status, 403);
  }
  value.setAccess({ userId: "91", sessionId: "92", roles: ["ADMINISTRADOR"] });
  assert.equal((await value.get("/interno/vehiculos/7")).status, 200);
  for (const id of ["0", "-1", "+1", "01", "1%20", "1234567890123456789", "x"]) {
    assert.equal((await value.get(`/interno/vehiculos/${id}`)).status, 400, id);
  }
  assert.equal((await value.get("/interno/vehiculos/9")).status, 404);
});

test("O01/O03 select one projection explicitly with canonical multirole priority", async (t) => {
  const value = await fixture(t, ["MECANICO", "INVENTARIO"]);
  assert.equal((await value.get("/interno/ordenes")).status, 200);
  assert.equal(value.calls.at(-1)[1].view, "TECNICA");
  assert.equal((await value.get("/interno/ordenes?vista=INVENTARIO")).status, 200);
  assert.equal(value.calls.at(-1)[1].view, "INVENTARIO");
  assert.equal((await value.get("/interno/ordenes?vista=RECEPCION")).status, 403);
  const detail = await value.get("/interno/ordenes/8?vista=TECNICA");
  assert.equal(detail.status, 200);
  assert.deepEqual((await detail.json()).data, { id: "8", projection: "TECNICA" });

  value.setAccess({ userId: "91", sessionId: "92", roles: ["ADMINISTRADOR", "MECANICO", "INVENTARIO"] });
  assert.equal((await value.get("/interno/ordenes")).status, 200);
  assert.equal(value.calls.at(-1)[1].view, "RECEPCION");
});

test("O01 validates ranges and all declared filters before querying", async (t) => {
  const { get, calls } = await fixture(t);
  const good = await get("/interno/ordenes?desde=2026-09-01T00%3A00%3A00-06%3A00&hasta=2026-10-01T00%3A00%3A00-06%3A00&estado=RECIBIDO&proposito=COMERCIAL&vehiculoId=7&activas=true");
  assert.equal(good.status, 200);
  assert.equal(calls.at(-1)[1].vehicleId, "7");
  const precise = await get("/interno/ordenes?desde=2026-09-12T10%3A11%3A12.123456-06%3A00");
  assert.equal(precise.status, 200);
  assert.equal(calls.at(-1)[1].from, "2026-09-12T16:11:12.123456Z");
  for (const path of [
    "/interno/ordenes?desde=2026-10-01T00%3A00%3A00Z&hasta=2026-09-01T00%3A00%3A00Z",
    "/interno/ordenes?estado=UNKNOWN", "/interno/ordenes?desde=2026-09-01", "/interno/ordenes?foo=bar",
    "/interno/ordenes?desde=2026-02-30T00%3A00%3A00Z",
  ]) assert.equal((await get(path)).status, 400, path);
});
