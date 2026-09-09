const DASHBOARD_PERIODS = Object.freeze({
  TODAY: "HOY",
  CURRENT_MONTH: "MES_ACTUAL",
});

const CURRENT_OPERATION = Object.freeze({
  ordenesPorEstado: Object.freeze([
    Object.freeze({ estado: "RECIBIDO", cantidad: 3 }),
    Object.freeze({ estado: "EN_DIAGNOSTICO", cantidad: 4 }),
    Object.freeze({ estado: "ESPERANDO_AUTORIZACION", cantidad: 2 }),
    Object.freeze({ estado: "EN_REPARACION", cantidad: 6 }),
    Object.freeze({ estado: "LISTO_PARA_ENTREGA", cantidad: 3 }),
    Object.freeze({ estado: "PENDIENTE_ENTREGA_SIN_REPARACION", cantidad: 1 }),
  ]),
  propuestasPendientes: 2,
  ampliacionesPendientes: 3,
  repuestosBajoMinimo: 7,
  reservasActivas: 12,
  saldoPendiente: "27350.00",
  saldoAFavor: "850.00",
  clientesConDeuda: 6,
});

const TODAY_DASHBOARD = Object.freeze({
  corteEn: "2026-09-09T16:30:00.000Z",
  zonaHoraria: "America/Guatemala",
  periodo: Object.freeze({
    tipo: DASHBOARD_PERIODS.TODAY,
    desde: "2026-09-09T06:00:00.000Z",
    hasta: "2026-09-10T06:00:00.000Z",
  }),
  actual: CURRENT_OPERATION,
  actividadPeriodo: Object.freeze({
    cobradoBruto: "12850.00",
    pagosAnulados: "450.00",
    cobradoNeto: "12400.00",
    entregadas: 5,
    entregadasSinReparacion: 1,
    garantiasAtendidasAceptadas: 2,
    garantiasAtendidasRechazadas: 1,
  }),
  citasProximas: Object.freeze({
    cantidad: 4,
    desde: "2026-09-09T16:30:00.000Z",
    hasta: "2026-09-10T06:00:00.000Z",
  }),
  solicitudesCitaPendientes: 5,
});

const CURRENT_MONTH_DASHBOARD = Object.freeze({
  corteEn: "2026-09-09T16:30:00.000Z",
  zonaHoraria: "America/Guatemala",
  periodo: Object.freeze({
    tipo: DASHBOARD_PERIODS.CURRENT_MONTH,
    desde: "2026-09-01T06:00:00.000Z",
    hasta: "2026-10-01T06:00:00.000Z",
  }),
  actual: CURRENT_OPERATION,
  actividadPeriodo: Object.freeze({
    cobradoBruto: "98450.00",
    pagosAnulados: "1650.00",
    cobradoNeto: "96800.00",
    entregadas: 38,
    entregadasSinReparacion: 4,
    garantiasAtendidasAceptadas: 7,
    garantiasAtendidasRechazadas: 3,
  }),
  citasProximas: Object.freeze({
    cantidad: 16,
    desde: "2026-09-09T16:30:00.000Z",
    hasta: "2026-10-01T06:00:00.000Z",
  }),
  solicitudesCitaPendientes: 5,
});

const RECENT_ACTIVITY = Object.freeze({
  [DASHBOARD_PERIODS.TODAY]: Object.freeze([
    Object.freeze({
      id: "evt-2048",
      tipo: "ORDEN",
      accion: "VEHICULO_LISTO",
      recursoId: "orden-1084",
      ocurridoEn: "2026-09-09T16:18:00.000Z",
      actor: Object.freeze({ id: "usuario-18", nombre: "Carlos Méndez" }),
      resumen: "Toyota Corolla 2018 quedó listo para entrega.",
    }),
    Object.freeze({
      id: "evt-2047",
      tipo: "PAGO",
      accion: "PAGO_REGISTRADO",
      recursoId: "pago-731",
      ocurridoEn: "2026-09-09T15:42:00.000Z",
      actor: Object.freeze({ id: "usuario-07", nombre: "Ana Lucía Pérez" }),
      resumen: "Se registró un abono para la orden TT-1079.",
    }),
    Object.freeze({
      id: "evt-2046",
      tipo: "INVENTARIO",
      accion: "RESERVA_CONFIRMADA",
      recursoId: "reserva-392",
      ocurridoEn: "2026-09-09T14:55:00.000Z",
      actor: Object.freeze({ id: "usuario-24", nombre: "Diego López" }),
      resumen: "Reserva de repuestos confirmada para la orden TT-1082.",
    }),
    Object.freeze({
      id: "evt-2044",
      tipo: "GARANTIA",
      accion: "COBERTURA_ACEPTADA",
      recursoId: "reclamo-86",
      ocurridoEn: "2026-09-09T13:20:00.000Z",
      actor: Object.freeze({ id: "usuario-03", nombre: "Sofía Herrera" }),
      resumen: "Cobertura aceptada para el reclamo de garantía TT-G086.",
    }),
  ]),
  [DASHBOARD_PERIODS.CURRENT_MONTH]: Object.freeze([
    Object.freeze({
      id: "evt-2048",
      tipo: "ORDEN",
      accion: "VEHICULO_LISTO",
      recursoId: "orden-1084",
      ocurridoEn: "2026-09-09T16:18:00.000Z",
      actor: Object.freeze({ id: "usuario-18", nombre: "Carlos Méndez" }),
      resumen: "Toyota Corolla 2018 quedó listo para entrega.",
    }),
    Object.freeze({
      id: "evt-2047",
      tipo: "PAGO",
      accion: "PAGO_REGISTRADO",
      recursoId: "pago-731",
      ocurridoEn: "2026-09-09T15:42:00.000Z",
      actor: Object.freeze({ id: "usuario-07", nombre: "Ana Lucía Pérez" }),
      resumen: "Se registró un abono para la orden TT-1079.",
    }),
    Object.freeze({
      id: "evt-2046",
      tipo: "INVENTARIO",
      accion: "RESERVA_CONFIRMADA",
      recursoId: "reserva-392",
      ocurridoEn: "2026-09-09T14:55:00.000Z",
      actor: Object.freeze({ id: "usuario-24", nombre: "Diego López" }),
      resumen: "Reserva de repuestos confirmada para la orden TT-1082.",
    }),
    Object.freeze({
      id: "evt-2044",
      tipo: "GARANTIA",
      accion: "COBERTURA_ACEPTADA",
      recursoId: "reclamo-86",
      ocurridoEn: "2026-09-09T13:20:00.000Z",
      actor: Object.freeze({ id: "usuario-03", nombre: "Sofía Herrera" }),
      resumen: "Cobertura aceptada para el reclamo de garantía TT-G086.",
    }),
    Object.freeze({
      id: "evt-1981",
      tipo: "ORDEN",
      accion: "VEHICULO_ENTREGADO",
      recursoId: "orden-1038",
      ocurridoEn: "2026-09-04T21:10:00.000Z",
      actor: Object.freeze({ id: "usuario-07", nombre: "Ana Lucía Pérez" }),
      resumen: "Vehículo entregado y comprobante final actualizado.",
    }),
  ]),
});

const DASHBOARD_FIXTURES = Object.freeze({
  [DASHBOARD_PERIODS.TODAY]: TODAY_DASHBOARD,
  [DASHBOARD_PERIODS.CURRENT_MONTH]: CURRENT_MONTH_DASHBOARD,
});

module.exports = {
  DASHBOARD_FIXTURES,
  DASHBOARD_PERIODS,
  RECENT_ACTIVITY,
};
