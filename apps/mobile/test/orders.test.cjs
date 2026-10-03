const test = require("node:test");
const assert = require("node:assert/strict");

const { ORDER_FIXTURES } = require("../src/features/orders/demoOrderFixtures");
const {
  DEMO_ORDER_SCENARIOS,
  createDemoOrderRepository,
} = require("../src/features/orders/demoOrderRepository");
const {
  ACTIVE_ORDER_STATES,
  ORDER_FILTERS,
  ORDER_STATES,
  filterOrders,
  getOrderDetailRoute,
  getOrderView,
  normalizeOrderFilter,
} = require("../src/features/orders/orderPresentation");

const ID_PATTERN = /^[1-9]\d{0,17}$/;
const MONEY_PATTERN = /^\d{1,12}\.\d{2}$/;
const QUANTITY_PATTERN = /^\d{1,9}\.\d{3}$/;
const KM_PATTERN = /^\d{1,9}\.\d$/;
const WORK_STATES = new Set(["PROPUESTO", "EN_EJECUCION", "COMPLETADO", "DETENIDO", "DESCARTADO"]);

// L03: decisión temporal: los datos demo de órdenes siguen para INVENTARIO aislado (también las pruebas «the demo covers…» y
// «demo repository…»); la levantaría el ticket que dé a INVENTARIO su espacio real.
test("demo orders preserve O01/O03 reception projection primitives", () => {
  assert.equal(ORDER_FIXTURES.length >= 4, true);

  for (const detail of ORDER_FIXTURES) {
    const { orden } = detail;
    assert.equal(ID_PATTERN.test(orden.id), true);
    assert.equal(ID_PATTERN.test(orden.version), true);
    assert.equal(ID_PATTERN.test(orden.vehiculo.id), true);
    assert.equal(ID_PATTERN.test(orden.clienteContractual.id), true);
    assert.equal(ID_PATTERN.test(orden.propiedadAperturaId), true);
    assert.equal(ORDER_STATES.includes(orden.estado), true);
    assert.equal(Number.isNaN(Date.parse(orden.ingresadoEn)), false);
    assert.equal(KM_PATTERN.test(orden.kilometrajeIngreso), true);
    assert.equal(MONEY_PATTERN.test(orden.saldo.montoDebido), true);
    assert.equal(MONEY_PATTERN.test(orden.saldo.pagadoValido), true);
    assert.equal(MONEY_PATTERN.test(orden.saldo.saldoPendiente), true);

    for (const work of detail.trabajos) {
      assert.equal(ID_PATTERN.test(work.id), true);
      assert.equal(WORK_STATES.has(work.estado), true);
      assert.equal(QUANTITY_PATTERN.test(work.horasEjecutadas), true);
      if (work.tipo === "DIAGNOSTICO") {
        assert.equal(typeof work.diagnosticoGratuito, "boolean");
      } else {
        assert.equal(Object.hasOwn(work, "diagnosticoGratuito"), false);
      }
    }

    for (const { repuesto, reserva } of detail.repuestos) {
      assert.equal(reserva.ordenId, orden.id);
      assert.equal(reserva.repuestoId, repuesto.id);
      const relatedWork = detail.trabajos.find(({ id }) => id === reserva.trabajoId);
      assert.ok(relatedWork);
      assert.equal(relatedWork.alcance.some(({ itemId }) => itemId === reserva.itemId), true);
      assert.equal(QUANTITY_PATTERN.test(reserva.cantidadReservada), true);
      assert.equal(MONEY_PATTERN.test(repuesto.precioVenta), true);
    }

    for (const event of detail.eventos) {
      assert.equal(ID_PATTERN.test(event.id), true);
      assert.equal(Number.isNaN(Date.parse(event.registradoEn)), false);
      assert.equal(event.estadoNuevo === null || ORDER_STATES.includes(event.estadoNuevo), true);
    }
  }
});

test("role priority selects one contract projection without merging fields", async () => {
  assert.equal(getOrderView(["ADMINISTRADOR"]), "RECEPCION");
  assert.equal(getOrderView(["MECANICO", "INVENTARIO"]), "TECNICA");
  assert.equal(getOrderView(["INVENTARIO"]), "INVENTARIO");

  const repository = createDemoOrderRepository({ delayMs: 0 });
  const [reception] = await repository.loadList("RECEPCION");
  const [technical] = await repository.loadList("TECNICA");
  const [inventory] = await repository.loadList("INVENTARIO");

  assert.equal(typeof reception.clienteContractual.nombre, "string");
  assert.equal(typeof reception.saldo.saldoPendiente, "string");
  assert.equal(Object.hasOwn(technical, "clienteContractual"), false);
  assert.equal(Object.hasOwn(technical, "saldo"), false);
  assert.equal(Object.hasOwn(inventory, "vehiculo"), false);
  assert.equal(Object.hasOwn(inventory, "ingresadoEn"), false);

  const inventoryDetail = await repository.loadDetail("1084", "INVENTARIO");
  assert.equal(inventoryDetail.diagnostico, null);
  assert.deepEqual(inventoryDetail.participantes, []);
  assert.deepEqual(inventoryDetail.eventos, []);
});

test("the demo covers the requested operational stories", () => {
  const states = new Set(ORDER_FIXTURES.map(({ orden }) => orden.estado));
  for (const required of ["EN_DIAGNOSTICO", "ESPERANDO_AUTORIZACION", "EN_REPARACION", "LISTO_PARA_ENTREGA"]) {
    assert.equal(states.has(required), true);
  }
});

test("primary list filters derive only from canonical states", () => {
  const orders = ORDER_FIXTURES.map(({ orden }) => orden);

  assert.equal(filterOrders(orders, ORDER_FILTERS.ALL).length, orders.length);
  assert.equal(
    filterOrders(orders, ORDER_FILTERS.ACTIVE).every(({ estado }) => ACTIVE_ORDER_STATES.includes(estado)),
    true,
  );
  assert.deepEqual(
    filterOrders(orders, ORDER_FILTERS.WAITING_AUTHORIZATION).map(({ estado }) => estado),
    ["ESPERANDO_AUTORIZACION"],
  );
  assert.deepEqual(
    new Set(filterOrders(orders, ORDER_FILTERS.READY_FOR_DELIVERY).map(({ estado }) => estado)),
    new Set(["LISTO_PARA_ENTREGA", "PENDIENTE_ENTREGA_SIN_REPARACION"]),
  );
  assert.equal(normalizeOrderFilter("NO_EXISTE"), ORDER_FILTERS.ALL);
});

test("list navigation targets the real dynamic detail route", () => {
  assert.deepEqual(getOrderDetailRoute("1084"), {
    pathname: "/interno/ordenes/[id]",
    params: { id: "1084" },
  });
});

test("demo repository represents data, recoverable error, empty and not found", async () => {
  const data = createDemoOrderRepository({ delayMs: 0 });
  assert.equal((await data.loadList()).length, ORDER_FIXTURES.length);
  assert.equal((await data.loadDetail("1084")).orden.id, "1084");
  assert.equal(await data.loadDetail("9999"), null);

  const empty = createDemoOrderRepository({ scenario: DEMO_ORDER_SCENARIOS.EMPTY, delayMs: 0 });
  assert.deepEqual(await empty.loadList(), []);
  assert.equal(await empty.loadDetail("1084"), null);

  const recoverable = createDemoOrderRepository({ scenario: DEMO_ORDER_SCENARIOS.ERROR_ONCE, delayMs: 0 });
  await assert.rejects(() => recoverable.loadList());
  await assert.doesNotReject(() => recoverable.loadList());
});
