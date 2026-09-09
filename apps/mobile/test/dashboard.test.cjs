const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DASHBOARD_FIXTURES,
  DASHBOARD_PERIODS,
  RECENT_ACTIVITY,
} = require("../src/features/dashboard/demoDashboardFixtures");
const {
  DEMO_SCENARIOS,
  createDemoDashboardRepository,
} = require("../src/features/dashboard/demoDashboardRepository");
const {
  ACTIVE_ORDER_STATES,
  formatMoney,
  getActiveOrdersTotal,
  getOrderCount,
  getReadyForDeliveryTotal,
} = require("../src/features/dashboard/dashboardPresentation");

const MONEY_PATTERN = /^-?\d+\.\d{2}$/;
const DASHBOARD_KEYS = [
  "corteEn",
  "zonaHoraria",
  "periodo",
  "actual",
  "actividadPeriodo",
  "citasProximas",
  "solicitudesCitaPendientes",
];

test("Dashboard fixtures keep the future H01 DTO shape and canonical types", () => {
  for (const period of Object.values(DASHBOARD_PERIODS)) {
    const dashboard = DASHBOARD_FIXTURES[period];

    assert.deepEqual(Object.keys(dashboard), DASHBOARD_KEYS);
    assert.equal(dashboard.zonaHoraria, "America/Guatemala");
    assert.equal(dashboard.periodo.tipo, period);
    assert.equal(Number.isNaN(Date.parse(dashboard.corteEn)), false);
    assert.equal(Number.isNaN(Date.parse(dashboard.periodo.desde)), false);
    assert.equal(Number.isNaN(Date.parse(dashboard.periodo.hasta)), false);
    assert.deepEqual(
      dashboard.actual.ordenesPorEstado.map(({ estado }) => estado),
      ACTIVE_ORDER_STATES,
    );
    assert.equal(MONEY_PATTERN.test(dashboard.actual.saldoPendiente), true);
    assert.equal(MONEY_PATTERN.test(dashboard.actual.saldoAFavor), true);
    assert.equal(
      MONEY_PATTERN.test(dashboard.actividadPeriodo.cobradoBruto),
      true,
    );
    assert.equal(
      MONEY_PATTERN.test(dashboard.actividadPeriodo.pagosAnulados),
      true,
    );
    assert.equal(
      MONEY_PATTERN.test(dashboard.actividadPeriodo.cobradoNeto),
      true,
    );
  }
});

test("recent activity fixtures are compatible with H02", () => {
  const allowedTypes = new Set(["ORDEN", "PAGO", "INVENTARIO", "GARANTIA"]);

  for (const item of Object.values(RECENT_ACTIVITY).flat()) {
    assert.equal(typeof item.id, "string");
    assert.equal(typeof item.recursoId, "string");
    assert.equal(allowedTypes.has(item.tipo), true);
    assert.equal(typeof item.accion, "string");
    assert.equal(typeof item.resumen, "string");
    assert.equal(Number.isNaN(Date.parse(item.ocurridoEn)), false);
    if (item.actor) {
      assert.equal(typeof item.actor.id, "string");
      assert.equal(typeof item.actor.nombre, "string");
    }
  }
});

test("Today and Current month load distinct period activity", async () => {
  const repository = createDemoDashboardRepository({ delayMs: 0 });
  const today = await repository.load(DASHBOARD_PERIODS.TODAY);
  const month = await repository.load(DASHBOARD_PERIODS.CURRENT_MONTH);

  assert.equal(today.dashboard.periodo.tipo, DASHBOARD_PERIODS.TODAY);
  assert.equal(
    month.dashboard.periodo.tipo,
    DASHBOARD_PERIODS.CURRENT_MONTH,
  );
  assert.notEqual(
    today.dashboard.actividadPeriodo.cobradoNeto,
    month.dashboard.actividadPeriodo.cobradoNeto,
  );
  assert.notEqual(today.activity.length, month.activity.length);
});

test("primary Dashboard data produces the required operational summaries", () => {
  const dashboard = DASHBOARD_FIXTURES[DASHBOARD_PERIODS.TODAY];

  assert.equal(getActiveOrdersTotal(dashboard.actual), 19);
  assert.equal(
    getOrderCount(dashboard.actual, "ESPERANDO_AUTORIZACION"),
    2,
  );
  assert.equal(getReadyForDeliveryTotal(dashboard.actual), 4);
  assert.equal(dashboard.actual.ampliacionesPendientes, 3);
  assert.equal(dashboard.actual.repuestosBajoMinimo, 7);
  assert.equal(dashboard.actual.reservasActivas, 12);
  assert.equal(dashboard.actual.clientesConDeuda, 6);
  assert.equal(formatMoney(dashboard.actividadPeriodo.cobradoNeto), "Q 12,400.00");
});

test("demo repository exposes recoverable error and successful empty states", async () => {
  const recoverable = createDemoDashboardRepository({
    scenario: DEMO_SCENARIOS.ERROR_ONCE,
    delayMs: 0,
  });
  await assert.rejects(() => recoverable.load(DASHBOARD_PERIODS.TODAY));
  await assert.doesNotReject(() => recoverable.load(DASHBOARD_PERIODS.TODAY));

  const empty = createDemoDashboardRepository({
    scenario: DEMO_SCENARIOS.EMPTY,
    delayMs: 0,
  });
  const result = await empty.load(DASHBOARD_PERIODS.TODAY);
  assert.equal(getActiveOrdersTotal(result.dashboard.actual), 0);
  assert.equal(result.activity.length, 0);
});
