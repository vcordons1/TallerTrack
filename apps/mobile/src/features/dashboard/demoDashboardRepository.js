const {
  DASHBOARD_FIXTURES,
  DASHBOARD_PERIODS,
  RECENT_ACTIVITY,
} = require("./demoDashboardFixtures");

const DEMO_SCENARIOS = Object.freeze({
  DATA: "DATA",
  EMPTY: "EMPTY",
  ERROR_ONCE: "ERROR_ONCE",
});

function emptyDashboard(period) {
  const fixture = DASHBOARD_FIXTURES[period];
  return {
    ...fixture,
    actual: {
      ...fixture.actual,
      ordenesPorEstado: fixture.actual.ordenesPorEstado.map(({ estado }) => ({
        estado,
        cantidad: 0,
      })),
      propuestasPendientes: 0,
      ampliacionesPendientes: 0,
      repuestosBajoMinimo: 0,
      reservasActivas: 0,
      saldoPendiente: "0.00",
      saldoAFavor: "0.00",
      clientesConDeuda: 0,
    },
    actividadPeriodo: {
      cobradoBruto: "0.00",
      pagosAnulados: "0.00",
      cobradoNeto: "0.00",
      entregadas: 0,
      entregadasSinReparacion: 0,
      garantiasAtendidasAceptadas: 0,
      garantiasAtendidasRechazadas: 0,
    },
    citasProximas: { ...fixture.citasProximas, cantidad: 0 },
    solicitudesCitaPendientes: 0,
  };
}

function createDemoDashboardRepository({
  scenario = DEMO_SCENARIOS.DATA,
  delayMs = 220,
} = {}) {
  let failedOnce = false;

  return Object.freeze({
    async load(period) {
      if (!Object.values(DASHBOARD_PERIODS).includes(period)) {
        throw new Error("El período solicitado no es compatible con Dashboard.");
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));

      if (scenario === DEMO_SCENARIOS.ERROR_ONCE && !failedOnce) {
        failedOnce = true;
        throw new Error("No fue posible cargar el corte de demostración.");
      }

      if (scenario === DEMO_SCENARIOS.EMPTY) {
        return { dashboard: emptyDashboard(period), activity: [] };
      }

      return {
        dashboard: DASHBOARD_FIXTURES[period],
        activity: RECENT_ACTIVITY[period],
      };
    },
  });
}

const demoDashboardRepository = createDemoDashboardRepository();

module.exports = {
  DEMO_SCENARIOS,
  createDemoDashboardRepository,
  demoDashboardRepository,
};
