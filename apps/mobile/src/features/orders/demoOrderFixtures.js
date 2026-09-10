const DEMO_CUTOFF = "2026-09-10T15:00:00.000Z";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }

  return value;
}

function vehicle(id, { type = "AUTOMOVIL", plate, vin = null, brand, model, year, color }) {
  return {
    id,
    tipoVehiculo: type,
    placa: plate,
    vin,
    marca: brand,
    modelo: model,
    anio: year,
    color,
    activo: true,
  };
}

function balance({ due, paid, net, pending, credit = "0.00", state, overdue = false, deliveredAt = null }) {
  return {
    moneda: "GTQ",
    montoDebido: due,
    pagadoValido: paid,
    saldoNeto: net,
    saldoPendiente: pending,
    saldoAFavor: credit,
    estadoEconomico: state,
    deudaVencida: overdue,
    entregadoEn: deliveredAt,
    calculadoEn: DEMO_CUTOFF,
  };
}

function order({
  id,
  version,
  vehicle: orderVehicle,
  state,
  enteredAt,
  mileage,
  reason,
  visibleDamage,
  customerId,
  customerName,
  propertyId,
  orderBalance,
  purpose = "COMERCIAL",
  closureReason = null,
  readyAt = null,
  deliveredAt = null,
  deliveryMileage = null,
  deliveredTo = null,
  stop = { solicitada: false, solicitadaEn: null, motivo: null },
  reconciliation = { situacion: "NO_REQUERIDA", bloqueos: [] },
}) {
  return {
    id,
    version,
    vehiculo: orderVehicle,
    proposito: purpose,
    estado: state,
    ingresadoEn: enteredAt,
    kilometrajeIngreso: mileage,
    motivoIngreso: reason,
    danosVisibles: visibleDamage,
    motivoCierre: closureReason,
    listoEn: readyAt,
    entregadoEn: deliveredAt,
    kilometrajeEntrega: deliveryMileage,
    entregadoA: deliveredTo,
    detencion: stop,
    conciliacion: reconciliation,
    clienteContractual: { id: customerId, nombre: customerName },
    propiedadAperturaId: propertyId,
    citaId: null,
    saldo: orderBalance,
  };
}

const ORDER_FIXTURES = [
  {
    orden: order({
      id: "1084",
      version: "7",
      vehicle: vehicle("204", { plate: "P-482KDX", brand: "Toyota", model: "Corolla", year: 2018, color: "Gris" }),
      state: "LISTO_PARA_ENTREGA",
      enteredAt: "2026-09-08T14:20:00.000Z",
      mileage: "86420.0",
      reason: "Ruido metálico al frenar y vibración leve en el pedal.",
      visibleDamage: "Rayón superficial en defensa trasera; documentado en recepción.",
      customerId: "41",
      customerName: "Daniela Ruiz",
      propertyId: "311",
      readyAt: "2026-09-10T13:45:00.000Z",
      orderBalance: balance({ due: "1480.00", paid: "1480.00", net: "0.00", pending: "0.00", state: "PAGADO" }),
      reconciliation: { situacion: "COMPLETA", bloqueos: [] },
    }),
    participantes: [{ id: "601", mecanico: { id: "18", nombre: "Carlos Méndez" }, asignadoEn: "2026-09-08T15:00:00.000Z", retiradoEn: null, motivoRetiro: null }],
    diagnostico: { id: "801", numeroRevision: 1, revisionAnteriorId: null, trabajoDiagnosticoId: "901", detalleTecnico: "Pastillas delanteras bajo límite y discos con alabeo medible.", resumenCliente: "El desgaste de frenos delanteros causaba el ruido y la vibración.", confirmadoEn: "2026-09-08T18:10:00.000Z" },
    trabajos: [
      { id: "901", version: "3", tipo: "DIAGNOSTICO", tipoServicio: "DIAGNOSTICO", descripcion: "Inspección del sistema de frenos", estado: "COMPLETADO", diagnosticoGratuito: true, horasEjecutadas: "0.500", alcance: [] },
      { id: "902", version: "5", tipo: "REPARACION", tipoServicio: "MECANICA_GENERAL", descripcion: "Cambio de pastillas y rectificación de discos delanteros", estado: "COMPLETADO", horasEjecutadas: "2.000", alcance: [{ itemId: "1002", presupuestoId: "951", estadoPropuesta: "APROBADO", ejecutable: true, bloqueos: [], horasRestantes: null, cantidadRestante: "0.000" }] },
    ],
    repuestos: [{
      repuesto: { id: "501", version: "4", codigo: "FR-PD-044", descripcion: "Juego de pastillas de freno delanteras", unidad: "UNIDAD", precioVenta: "680.00", stockMinimo: "2.000", activo: true, existenciaFisica: "7.000", reservadoActivo: "0.000", disponible: "7.000" },
      reserva: { id: "701", ordenId: "1084", trabajoId: "902", itemId: "1002", repuestoId: "501", cantidadReservada: "1.000", cantidadActiva: "0.000", cantidadConsumida: "1.000", cantidadLiberada: "0.000" },
    }],
    eventos: [
      { id: "1201", tipo: "ORDEN_RECIBIDA", estadoAnterior: null, estadoNuevo: "RECIBIDO", motivo: "Recepción registrada", registradoEn: "2026-09-08T14:20:00.000Z", actor: { id: "7", nombre: "Ana Lucía Pérez" } },
      { id: "1202", tipo: "DIAGNOSTICO_CONFIRMADO", estadoAnterior: "EN_DIAGNOSTICO", estadoNuevo: "ESPERANDO_AUTORIZACION", motivo: "Informe técnico confirmado y propuesta emitida", registradoEn: "2026-09-08T18:15:00.000Z", actor: { id: "18", nombre: "Carlos Méndez" } },
      { id: "1203", tipo: "REPARACION_INICIADA", estadoAnterior: "ESPERANDO_AUTORIZACION", estadoNuevo: "EN_REPARACION", motivo: "Primer trabajo autorizado iniciado", registradoEn: "2026-09-09T14:05:00.000Z", actor: { id: "18", nombre: "Carlos Méndez" } },
      { id: "1204", tipo: "VEHICULO_LISTO", estadoAnterior: "EN_REPARACION", estadoNuevo: "LISTO_PARA_ENTREGA", motivo: "Trabajos cerrados y conciliación completa", registradoEn: "2026-09-10T13:45:00.000Z", actor: { id: "18", nombre: "Carlos Méndez" } },
    ],
  },
  {
    orden: order({
      id: "1083",
      version: "4",
      vehicle: vehicle("203", { plate: "P-719JRM", brand: "Mazda", model: "3", year: 2020, color: "Rojo" }),
      state: "EN_REPARACION",
      enteredAt: "2026-09-09T13:05:00.000Z",
      mileage: "52118.0",
      reason: "Pérdida de potencia y luz de motor encendida.",
      visibleDamage: "Sin daños visibles adicionales al ingreso.",
      customerId: "40",
      customerName: "Luis Fernando Soto",
      propertyId: "310",
      orderBalance: balance({ due: "950.00", paid: "400.00", net: "550.00", pending: "550.00", state: "PARCIAL" }),
    }),
    participantes: [{ id: "600", mecanico: { id: "23", nombre: "José Ramírez" }, asignadoEn: "2026-09-09T13:30:00.000Z", retiradoEn: null, motivoRetiro: null }],
    diagnostico: { id: "800", numeroRevision: 1, revisionAnteriorId: null, trabajoDiagnosticoId: "899", detalleTecnico: "Bobina del cilindro 2 con fallo intermitente y bujías fuera de especificación.", resumenCliente: "Se identificó una falla de encendido en el cilindro 2.", confirmadoEn: "2026-09-09T15:40:00.000Z" },
    trabajos: [
      { id: "899", version: "2", tipo: "DIAGNOSTICO", tipoServicio: "DIAGNOSTICO", descripcion: "Lectura de códigos y pruebas de encendido", estado: "COMPLETADO", diagnosticoGratuito: false, horasEjecutadas: "1.000", alcance: [] },
      { id: "900", version: "2", tipo: "REPARACION", tipoServicio: "ELECTRICO", descripcion: "Sustitución de bobina y juego de bujías", estado: "EN_EJECUCION", horasEjecutadas: "0.750", alcance: [{ itemId: "1001", presupuestoId: "950", estadoPropuesta: "APROBADO", ejecutable: true, bloqueos: [], horasRestantes: null, cantidadRestante: "1.000" }] },
    ],
    repuestos: [{
      repuesto: { id: "500", version: "6", codigo: "EL-BOB-018", descripcion: "Bobina de encendido", unidad: "UNIDAD", precioVenta: "490.00", stockMinimo: "2.000", activo: true, existenciaFisica: "5.000", reservadoActivo: "1.000", disponible: "4.000" },
      reserva: { id: "700", ordenId: "1083", trabajoId: "900", itemId: "1001", repuestoId: "500", cantidadReservada: "1.000", cantidadActiva: "1.000", cantidadConsumida: "0.000", cantidadLiberada: "0.000" },
    }],
    eventos: [
      { id: "1197", tipo: "ORDEN_RECIBIDA", estadoAnterior: null, estadoNuevo: "RECIBIDO", motivo: "Recepción registrada", registradoEn: "2026-09-09T13:05:00.000Z", actor: { id: "7", nombre: "Ana Lucía Pérez" } },
      { id: "1198", tipo: "DIAGNOSTICO_CONFIRMADO", estadoAnterior: "EN_DIAGNOSTICO", estadoNuevo: "ESPERANDO_AUTORIZACION", motivo: "Informe y propuesta emitidos", registradoEn: "2026-09-09T15:45:00.000Z", actor: { id: "23", nombre: "José Ramírez" } },
      { id: "1199", tipo: "REPARACION_INICIADA", estadoAnterior: "ESPERANDO_AUTORIZACION", estadoNuevo: "EN_REPARACION", motivo: "Alcance autorizado iniciado", registradoEn: "2026-09-10T12:15:00.000Z", actor: { id: "23", nombre: "José Ramírez" } },
    ],
  },
  {
    orden: order({
      id: "1082",
      version: "3",
      vehicle: vehicle("202", { plate: "P-156HKT", brand: "Honda", model: "CR-V", year: 2017, color: "Azul" }),
      state: "ESPERANDO_AUTORIZACION",
      enteredAt: "2026-09-09T15:10:00.000Z",
      mileage: "103284.0",
      reason: "Aire acondicionado enfría de forma intermitente.",
      visibleDamage: "Golpe antiguo en puerta derecha, informado por la cliente.",
      customerId: "39",
      customerName: "María José Aguilar",
      propertyId: "309",
      orderBalance: balance({ due: "250.00", paid: "0.00", net: "250.00", pending: "250.00", state: "PENDIENTE" }),
    }),
    participantes: [{ id: "599", mecanico: { id: "18", nombre: "Carlos Méndez" }, asignadoEn: "2026-09-09T15:35:00.000Z", retiradoEn: null, motivoRetiro: null }],
    diagnostico: { id: "799", numeroRevision: 1, revisionAnteriorId: null, trabajoDiagnosticoId: "897", detalleTecnico: "Fuga localizada en sello del compresor; presión baja en circuito.", resumenCliente: "Se detectó una fuga en el sistema de aire acondicionado.", confirmadoEn: "2026-09-10T11:20:00.000Z" },
    trabajos: [
      { id: "897", version: "2", tipo: "DIAGNOSTICO", tipoServicio: "AIRE_ACONDICIONADO", descripcion: "Prueba de presión y detección de fuga", estado: "COMPLETADO", diagnosticoGratuito: false, horasEjecutadas: "1.000", alcance: [] },
      { id: "898", version: "1", tipo: "REPARACION", tipoServicio: "AIRE_ACONDICIONADO", descripcion: "Cambio de sello, vacío y recarga del sistema", estado: "PROPUESTO", horasEjecutadas: "0.000", alcance: [] },
    ],
    repuestos: [],
    eventos: [
      { id: "1194", tipo: "ORDEN_RECIBIDA", estadoAnterior: null, estadoNuevo: "RECIBIDO", motivo: "Recepción registrada", registradoEn: "2026-09-09T15:10:00.000Z", actor: { id: "7", nombre: "Ana Lucía Pérez" } },
      { id: "1195", tipo: "DIAGNOSTICO_CONFIRMADO", estadoAnterior: "EN_DIAGNOSTICO", estadoNuevo: "ESPERANDO_AUTORIZACION", motivo: "Propuesta de reparación emitida", registradoEn: "2026-09-10T11:25:00.000Z", actor: { id: "18", nombre: "Carlos Méndez" } },
    ],
  },
  {
    orden: order({
      id: "1081",
      version: "2",
      vehicle: vehicle("201", { type: "MOTOCICLETA", plate: "M-904FZT", brand: "Yamaha", model: "FZ 2.0", year: 2022, color: "Negro" }),
      state: "EN_DIAGNOSTICO",
      enteredAt: "2026-09-10T12:40:00.000Z",
      mileage: "18406.0",
      reason: "Dificultad para encender en frío.",
      visibleDamage: "Sin daños visibles al ingreso.",
      customerId: "38",
      customerName: "Andrés Molina",
      propertyId: "308",
      orderBalance: balance({ due: "0.00", paid: "0.00", net: "0.00", pending: "0.00", state: "SIN_CARGOS" }),
    }),
    participantes: [{ id: "598", mecanico: { id: "23", nombre: "José Ramírez" }, asignadoEn: "2026-09-10T13:00:00.000Z", retiradoEn: null, motivoRetiro: null }],
    diagnostico: null,
    trabajos: [{ id: "896", version: "1", tipo: "DIAGNOSTICO", tipoServicio: "DIAGNOSTICO", descripcion: "Prueba de batería, bujía y alimentación", estado: "EN_EJECUCION", diagnosticoGratuito: true, horasEjecutadas: "0.250", alcance: [] }],
    repuestos: [],
    eventos: [
      { id: "1192", tipo: "ORDEN_RECIBIDA", estadoAnterior: null, estadoNuevo: "RECIBIDO", motivo: "Recepción registrada", registradoEn: "2026-09-10T12:40:00.000Z", actor: { id: "7", nombre: "Ana Lucía Pérez" } },
      { id: "1193", tipo: "DIAGNOSTICO_INICIADO", estadoAnterior: "RECIBIDO", estadoNuevo: "EN_DIAGNOSTICO", motivo: "Diagnóstico gratuito iniciado", registradoEn: "2026-09-10T13:20:00.000Z", actor: { id: "23", nombre: "José Ramírez" } },
    ],
  },
  {
    orden: order({
      id: "1080",
      version: "4",
      vehicle: vehicle("200", { plate: "P-338GNL", brand: "Nissan", model: "Versa", year: 2016, color: "Blanco" }),
      state: "PENDIENTE_ENTREGA_SIN_REPARACION",
      enteredAt: "2026-09-07T16:00:00.000Z",
      mileage: "127930.0",
      reason: "Revisión por sobrecalentamiento ocasional.",
      visibleDamage: "Abolladura pequeña en guardafango delantero izquierdo.",
      customerId: "37",
      customerName: "Elena Castillo",
      propertyId: "307",
      closureReason: "La cliente rechazó la propuesta de reparación.",
      orderBalance: balance({ due: "300.00", paid: "300.00", net: "0.00", pending: "0.00", state: "PAGADO" }),
      reconciliation: { situacion: "COMPLETA", bloqueos: [] },
    }),
    participantes: [{ id: "597", mecanico: { id: "18", nombre: "Carlos Méndez" }, asignadoEn: "2026-09-07T16:25:00.000Z", retiradoEn: null, motivoRetiro: null }],
    diagnostico: { id: "798", numeroRevision: 1, revisionAnteriorId: null, trabajoDiagnosticoId: "895", detalleTecnico: "Termostato trabado y deterioro visible en manguera superior.", resumenCliente: "El termostato no abre correctamente y la manguera superior requiere cambio.", confirmadoEn: "2026-09-08T13:30:00.000Z" },
    trabajos: [
      { id: "895", version: "2", tipo: "DIAGNOSTICO", tipoServicio: "DIAGNOSTICO", descripcion: "Prueba del circuito de enfriamiento", estado: "COMPLETADO", diagnosticoGratuito: false, horasEjecutadas: "1.000", alcance: [] },
      { id: "894", version: "2", tipo: "REPARACION", tipoServicio: "MECANICA_GENERAL", descripcion: "Cambio de termostato y manguera superior", estado: "DESCARTADO", horasEjecutadas: "0.000", alcance: [] },
    ],
    repuestos: [],
    eventos: [
      { id: "1189", tipo: "ORDEN_RECIBIDA", estadoAnterior: null, estadoNuevo: "RECIBIDO", motivo: "Recepción registrada", registradoEn: "2026-09-07T16:00:00.000Z", actor: { id: "7", nombre: "Ana Lucía Pérez" } },
      { id: "1190", tipo: "DIAGNOSTICO_CONFIRMADO", estadoAnterior: "EN_DIAGNOSTICO", estadoNuevo: "ESPERANDO_AUTORIZACION", motivo: "Propuesta de reparación emitida", registradoEn: "2026-09-08T13:35:00.000Z", actor: { id: "18", nombre: "Carlos Méndez" } },
      { id: "1191", tipo: "PROPUESTA_RECHAZADA", estadoAnterior: "ESPERANDO_AUTORIZACION", estadoNuevo: "PENDIENTE_ENTREGA_SIN_REPARACION", motivo: "Propuesta rechazada por la cliente", registradoEn: "2026-09-08T17:10:00.000Z", actor: { id: "7", nombre: "Ana Lucía Pérez" } },
    ],
  },
  {
    orden: order({
      id: "1079",
      version: "8",
      vehicle: vehicle("199", { plate: "P-822DQS", brand: "Ford", model: "Ranger", year: 2019, color: "Plata" }),
      state: "ENTREGADO",
      enteredAt: "2026-09-03T14:15:00.000Z",
      mileage: "74410.0",
      reason: "Servicio preventivo de 75,000 km.",
      visibleDamage: "Marcas de uso en compuerta trasera.",
      customerId: "36",
      customerName: "Roberto Caal",
      propertyId: "306",
      closureReason: "Mantenimiento completado y vehículo entregado.",
      readyAt: "2026-09-04T18:00:00.000Z",
      deliveredAt: "2026-09-05T15:20:00.000Z",
      deliveryMileage: "74416.0",
      deliveredTo: "Roberto Caal",
      orderBalance: balance({ due: "2125.00", paid: "1500.00", net: "625.00", pending: "625.00", state: "PARCIAL", overdue: true, deliveredAt: "2026-09-05T15:20:00.000Z" }),
      reconciliation: { situacion: "COMPLETA", bloqueos: [] },
    }),
    participantes: [{ id: "596", mecanico: { id: "23", nombre: "José Ramírez" }, asignadoEn: "2026-09-03T15:00:00.000Z", retiradoEn: null, motivoRetiro: null }],
    diagnostico: { id: "797", numeroRevision: 1, revisionAnteriorId: null, trabajoDiagnosticoId: "892", detalleTecnico: "Inspección preventiva sin hallazgos críticos.", resumenCliente: "La inspección no encontró fallas críticas adicionales.", confirmadoEn: "2026-09-03T17:00:00.000Z" },
    trabajos: [
      { id: "892", version: "2", tipo: "DIAGNOSTICO", tipoServicio: "DIAGNOSTICO", descripcion: "Inspección preventiva inicial", estado: "COMPLETADO", diagnosticoGratuito: true, horasEjecutadas: "0.500", alcance: [] },
      { id: "893", version: "4", tipo: "REPARACION", tipoServicio: "MANTENIMIENTO_PREVENTIVO", descripcion: "Cambio de aceite, filtros e inspección general", estado: "COMPLETADO", horasEjecutadas: "2.500", alcance: [] },
    ],
    repuestos: [],
    eventos: [
      { id: "1186", tipo: "ORDEN_RECIBIDA", estadoAnterior: null, estadoNuevo: "RECIBIDO", motivo: "Recepción registrada", registradoEn: "2026-09-03T14:15:00.000Z", actor: { id: "7", nombre: "Ana Lucía Pérez" } },
      { id: "1187", tipo: "VEHICULO_LISTO", estadoAnterior: "EN_REPARACION", estadoNuevo: "LISTO_PARA_ENTREGA", motivo: "Mantenimiento y conciliación completos", registradoEn: "2026-09-04T18:00:00.000Z", actor: { id: "23", nombre: "José Ramírez" } },
      { id: "1188", tipo: "VEHICULO_ENTREGADO", estadoAnterior: "LISTO_PARA_ENTREGA", estadoNuevo: "ENTREGADO", motivo: "Entrega física registrada", registradoEn: "2026-09-05T15:20:00.000Z", actor: { id: "7", nombre: "Ana Lucía Pérez" } },
    ],
  },
];

deepFreeze(ORDER_FIXTURES);

module.exports = {
  DEMO_CUTOFF,
  ORDER_FIXTURES,
};
