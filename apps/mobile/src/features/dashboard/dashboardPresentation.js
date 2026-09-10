const ACTIVE_ORDER_STATES = Object.freeze([
  "RECIBIDO",
  "EN_DIAGNOSTICO",
  "ESPERANDO_AUTORIZACION",
  "EN_REPARACION",
  "LISTO_PARA_ENTREGA",
  "PENDIENTE_ENTREGA_SIN_REPARACION",
]);

const ORDER_STATE_LABELS = Object.freeze({
  RECIBIDO: "Recibidas",
  EN_DIAGNOSTICO: "En diagnóstico",
  ESPERANDO_AUTORIZACION: "Esperando autorización",
  EN_REPARACION: "En reparación",
  LISTO_PARA_ENTREGA: "Listas para entrega",
  PENDIENTE_ENTREGA_SIN_REPARACION: "Entrega sin reparación",
});

const ACTIVITY_TYPE_LABELS = Object.freeze({
  ORDEN: "Orden",
  PAGO: "Pago",
  INVENTARIO: "Inventario",
  GARANTIA: "Garantía",
});

const ACTIVITY_ACTION_LABELS = Object.freeze({
  VEHICULO_LISTO: "Vehículo listo",
  VEHICULO_ENTREGADO: "Vehículo entregado",
  PAGO_REGISTRADO: "Pago registrado",
  RESERVA_CONFIRMADA: "Reserva confirmada",
  COBERTURA_ACEPTADA: "Cobertura aceptada",
});

function getOrderCount(actual, estado) {
  return (
    actual.ordenesPorEstado.find((item) => item.estado === estado)?.cantidad ?? 0
  );
}

function getActiveOrdersTotal(actual) {
  return actual.ordenesPorEstado
    .filter(({ estado }) => ACTIVE_ORDER_STATES.includes(estado))
    .reduce((total, { cantidad }) => total + cantidad, 0);
}

function getReadyForDeliveryTotal(actual) {
  return (
    getOrderCount(actual, "LISTO_PARA_ENTREGA") +
    getOrderCount(actual, "PENDIENTE_ENTREGA_SIN_REPARACION")
  );
}

function formatMoney(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) {
    return value;
  }

  const [, sign, whole, decimal = "00"] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}Q ${grouped}.${decimal.padEnd(2, "0")}`;
}

function formatCutoff(instant, timeZone) {
  return new Intl.DateTimeFormat("es-GT", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}

function formatActivityTime(instant, timeZone) {
  return new Intl.DateTimeFormat("es-GT", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}

module.exports = {
  ACTIVE_ORDER_STATES,
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_TYPE_LABELS,
  ORDER_STATE_LABELS,
  formatActivityTime,
  formatCutoff,
  formatMoney,
  getActiveOrdersTotal,
  getOrderCount,
  getReadyForDeliveryTotal,
};
