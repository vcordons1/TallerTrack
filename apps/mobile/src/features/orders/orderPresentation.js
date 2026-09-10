const ORDER_STATES = Object.freeze([
  "RECIBIDO",
  "EN_DIAGNOSTICO",
  "ESPERANDO_AUTORIZACION",
  "EN_REPARACION",
  "LISTO_PARA_ENTREGA",
  "PENDIENTE_ENTREGA_SIN_REPARACION",
  "ENTREGADO",
  "ENTREGADO_SIN_REPARACION",
  "CANCELADO",
]);

const ACTIVE_ORDER_STATES = Object.freeze(ORDER_STATES.slice(0, 6));

const ORDER_FILTERS = Object.freeze({
  ALL: "TODAS",
  ACTIVE: "ACTIVAS",
  WAITING_AUTHORIZATION: "ESPERANDO_AUTORIZACION",
  READY_FOR_DELIVERY: "LISTAS_PARA_ENTREGA",
});

const ORDER_VIEWS = Object.freeze({
  RECEPTION: "RECEPCION",
  TECHNICAL: "TECNICA",
  INVENTORY: "INVENTARIO",
});

const FILTER_OPTIONS = Object.freeze([
  Object.freeze({ value: ORDER_FILTERS.ALL, label: "Todas" }),
  Object.freeze({ value: ORDER_FILTERS.ACTIVE, label: "Activas" }),
  Object.freeze({ value: ORDER_FILTERS.WAITING_AUTHORIZATION, label: "Esperando autorización" }),
  Object.freeze({ value: ORDER_FILTERS.READY_FOR_DELIVERY, label: "Listas para entrega" }),
]);

const ORDER_STATUS_PRESENTATION = Object.freeze({
  RECIBIDO: { label: "Recibida", tone: "neutral", icon: "inbox-arrow-down-outline" },
  EN_DIAGNOSTICO: { label: "En diagnóstico", tone: "info", icon: "stethoscope" },
  ESPERANDO_AUTORIZACION: { label: "Esperando autorización", tone: "warning", icon: "clock-alert-outline" },
  EN_REPARACION: { label: "En reparación", tone: "info", icon: "tools" },
  LISTO_PARA_ENTREGA: { label: "Lista para entrega", tone: "success", icon: "check-circle-outline" },
  PENDIENTE_ENTREGA_SIN_REPARACION: { label: "Entrega sin reparación", tone: "warning", icon: "car-arrow-right" },
  ENTREGADO: { label: "Entregada", tone: "success", icon: "car-check" },
  ENTREGADO_SIN_REPARACION: { label: "Entregada sin reparación", tone: "neutral", icon: "car-outline" },
  CANCELADO: { label: "Cancelada", tone: "danger", icon: "close-circle-outline" },
});

const WORK_STATUS_PRESENTATION = Object.freeze({
  PROPUESTO: { label: "Propuesto", tone: "warning" },
  EN_EJECUCION: { label: "En ejecución", tone: "info" },
  COMPLETADO: { label: "Completado", tone: "success" },
  DETENIDO: { label: "Detenido", tone: "danger" },
  DESCARTADO: { label: "Descartado", tone: "neutral" },
});

const EVENT_LABELS = Object.freeze({
  ORDEN_RECIBIDA: "Orden recibida",
  DIAGNOSTICO_INICIADO: "Diagnóstico iniciado",
  DIAGNOSTICO_CONFIRMADO: "Diagnóstico confirmado",
  PROPUESTA_RECHAZADA: "Propuesta rechazada",
  REPARACION_INICIADA: "Reparación iniciada",
  VEHICULO_LISTO: "Vehículo listo",
  VEHICULO_ENTREGADO: "Vehículo entregado",
});

function normalizeOrderFilter(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return Object.values(ORDER_FILTERS).includes(candidate)
    ? candidate
    : ORDER_FILTERS.ALL;
}

function getOrderView(roles = []) {
  const assigned = new Set(roles);
  if (assigned.has("ADMINISTRADOR") || assigned.has("RECEPCIONISTA")) {
    return ORDER_VIEWS.RECEPTION;
  }
  if (assigned.has("MECANICO")) return ORDER_VIEWS.TECHNICAL;
  if (assigned.has("INVENTARIO")) return ORDER_VIEWS.INVENTORY;
  return null;
}

function filterOrders(orders, filter) {
  switch (normalizeOrderFilter(filter)) {
    case ORDER_FILTERS.ACTIVE:
      return orders.filter(({ estado }) => ACTIVE_ORDER_STATES.includes(estado));
    case ORDER_FILTERS.WAITING_AUTHORIZATION:
      return orders.filter(({ estado }) => estado === "ESPERANDO_AUTORIZACION");
    case ORDER_FILTERS.READY_FOR_DELIVERY:
      return orders.filter(({ estado }) =>
        ["LISTO_PARA_ENTREGA", "PENDIENTE_ENTREGA_SIN_REPARACION"].includes(estado),
      );
    default:
      return orders;
  }
}

function getOrderCode(id) {
  return `TT-${id}`;
}

function getOrderDetailRoute(id) {
  return { pathname: "/interno/ordenes/[id]", params: { id: String(id) } };
}

function getVehicleLabel(vehicle) {
  if (!vehicle) return "Orden de servicio";
  return [vehicle.marca, vehicle.modelo, vehicle.anio].filter(Boolean).join(" ");
}

function getOrderAttention(order) {
  if (order.detencion.solicitada) {
    return { label: "Detenida; requiere conciliación", tone: "danger", icon: "alert-octagon-outline" };
  }

  const attentionByState = {
    RECIBIDO: { label: "Pendiente de diagnóstico", tone: "neutral", icon: "clipboard-clock-outline" },
    EN_DIAGNOSTICO: { label: "Diagnóstico técnico en curso", tone: "info", icon: "progress-wrench" },
    ESPERANDO_AUTORIZACION: { label: "Requiere decisión del cliente", tone: "warning", icon: "account-clock-outline" },
    EN_REPARACION: { label: "Trabajo autorizado en curso", tone: "info", icon: "tools" },
    LISTO_PARA_ENTREGA: { label: "Preparada para entrega", tone: "success", icon: "car-arrow-right" },
    PENDIENTE_ENTREGA_SIN_REPARACION: { label: "Pendiente de entrega física", tone: "warning", icon: "car-arrow-right" },
    ENTREGADO: { label: "Atención finalizada", tone: "success", icon: "check-decagram-outline" },
    ENTREGADO_SIN_REPARACION: { label: "Atención finalizada sin reparación", tone: "neutral", icon: "check-outline" },
    CANCELADO: { label: "Apertura cancelada", tone: "danger", icon: "close-circle-outline" },
  };

  return attentionByState[order.estado] ?? {
    label: "Estado no reconocido; vuelve a cargar",
    tone: "danger",
    icon: "help-circle-outline",
  };
}

function formatDateTime(instant) {
  return new Intl.DateTimeFormat("es-GT", {
    timeZone: "America/Guatemala",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}

function formatMoney(value) {
  const match = /^(\-?)(\d+)\.(\d{2})$/.exec(value);
  if (!match) return value;
  const [, sign, whole, decimal] = match;
  return `${sign}Q ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimal}`;
}

function formatQuantity(value) {
  return Number(value).toLocaleString("es-GT", { maximumFractionDigits: 3 });
}

module.exports = {
  ACTIVE_ORDER_STATES,
  EVENT_LABELS,
  FILTER_OPTIONS,
  ORDER_FILTERS,
  ORDER_STATES,
  ORDER_STATUS_PRESENTATION,
  ORDER_VIEWS,
  WORK_STATUS_PRESENTATION,
  filterOrders,
  formatDateTime,
  formatMoney,
  formatQuantity,
  getOrderAttention,
  getOrderCode,
  getOrderDetailRoute,
  getOrderView,
  getVehicleLabel,
  normalizeOrderFilter,
};
