const { ORDER_FIXTURES } = require("./demoOrderFixtures");
const { ORDER_VIEWS } = require("./orderPresentation");

const DEMO_ORDER_SCENARIOS = Object.freeze({
  DATA: "DATA",
  EMPTY: "EMPTY",
  ERROR_ONCE: "ERROR_ONCE",
});

function createDemoOrderRepository({
  scenario = DEMO_ORDER_SCENARIOS.DATA,
  delayMs = 180,
} = {}) {
  let failedOnce = false;

  async function simulateRead() {
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    if (scenario === DEMO_ORDER_SCENARIOS.ERROR_ONCE && !failedOnce) {
      failedOnce = true;
      throw new Error("No fue posible cargar las órdenes de demostración.");
    }
  }

  return Object.freeze({
    async loadList(view = ORDER_VIEWS.RECEPTION) {
      await simulateRead();
      return scenario === DEMO_ORDER_SCENARIOS.EMPTY
        ? []
        : ORDER_FIXTURES.map(({ orden }) => projectOrder(orden, view));
    },

    async loadDetail(id, view = ORDER_VIEWS.RECEPTION) {
      await simulateRead();
      if (scenario === DEMO_ORDER_SCENARIOS.EMPTY) return null;
      const detail = ORDER_FIXTURES.find(({ orden }) => orden.id === String(id));
      return detail ? projectDetail(detail, view) : null;
    },
  });
}

function projectOrder(order, view) {
  if (view === ORDER_VIEWS.INVENTORY) {
    const { id, version, estado, proposito, detencion } = order;
    return { id, version, estado, proposito, detencion };
  }

  if (view === ORDER_VIEWS.TECHNICAL) {
    const {
      clienteContractual,
      propiedadAperturaId,
      citaId,
      saldo,
      ...technicalOrder
    } = order;
    return technicalOrder;
  }

  return order;
}

function projectDetail(detail, view) {
  if (view === ORDER_VIEWS.INVENTORY) {
    return {
      orden: projectOrder(detail.orden, view),
      participantes: [],
      diagnostico: null,
      trabajos: [],
      repuestos: detail.repuestos,
      eventos: [],
    };
  }

  return { ...detail, orden: projectOrder(detail.orden, view) };
}

const demoOrderRepository = createDemoOrderRepository();

module.exports = {
  DEMO_ORDER_SCENARIOS,
  createDemoOrderRepository,
  demoOrderRepository,
};
