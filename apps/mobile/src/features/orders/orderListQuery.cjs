const { ORDER_FILTERS, normalizeOrderFilter } = require("./orderPresentation");

// O01 filters are applied by the server so paging never hides real orders. "Listas para
// entrega" spans two states, which O01's single `estado` cannot express: the server narrows
// to active orders and the screen keeps its local state filter on top.
function orderListQuery(view, cursor, { filter, vehicleId } = {}) {
  const params = new URLSearchParams({ vista: view, limite: "25" });
  switch (normalizeOrderFilter(filter)) {
    case ORDER_FILTERS.ACTIVE:
    case ORDER_FILTERS.READY_FOR_DELIVERY:
      params.set("activas", "true");
      break;
    case ORDER_FILTERS.WAITING_AUTHORIZATION:
      params.set("estado", "ESPERANDO_AUTORIZACION");
      break;
    default:
      break;
  }
  if (vehicleId) params.set("vehiculoId", String(vehicleId));
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

module.exports = { orderListQuery };
