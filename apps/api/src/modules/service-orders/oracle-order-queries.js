import oracledb from "oracledb";

import { createOracleQueryExecutor } from "../../platform/oracle-query.js";

function technicalVehicle(row) {
  return {
    id: row.vehiculo_id, tipoVehiculo: row.codigo_tipo,
    placa: row.placa ?? null, vin: row.vin ?? null, marca: row.marca, modelo: row.modelo,
    anio: row.anio ?? null, color: row.color ?? null, activo: row.vehiculo_activo === 1,
  };
}

function detention() {
  return { solicitada: false, solicitadaEn: null, motivo: null };
}

function reconciliation() {
  return { situacion: "NO_REQUERIDA", bloqueos: [] };
}

function baseOrder(row) {
  return {
    id: row.id, version: row.version, vehiculo: technicalVehicle(row),
    proposito: row.proposito, estado: row.estado, ingresadoEn: row.ingresado_en,
    kilometrajeIngreso: row.kilometraje_ingreso, motivoIngreso: row.motivo_ingreso,
    danosVisibles: row.danos_visibles, motivoCierre: row.motivo_cierre ?? null,
    listoEn: row.listo_en ?? null, entregadoEn: row.entregado_en ?? null,
    kilometrajeEntrega: row.kilometraje_entrega ?? null, entregadoA: row.entregado_a ?? null,
    detencion: detention(), conciliacion: reconciliation(),
  };
}

function projected(row, view) {
  if (view === "INVENTARIO") {
    return { id: row.id, version: row.version, estado: row.estado, proposito: row.proposito, detencion: detention() };
  }
  const result = baseOrder(row);
  if (view === "RECEPCION") {
    result.clienteContractual = { id: row.cliente_id, nombre: row.cliente_nombre };
    result.propiedadAperturaId = row.propiedad_apertura_id;
    result.citaId = row.cita_id ?? null;
    // V017 has no persisted charges or payments: I06 does not exist yet.
    // Every currently representable order therefore has the empty-set balance.
    // Replace this projection with the canonical Oracle saldo view when I06 lands.
    result.saldo = {
      moneda: "GTQ", montoDebido: "0.00", pagadoValido: "0.00", saldoNeto: "0.00",
      saldoPendiente: "0.00", saldoAFavor: "0.00", estadoEconomico: "SIN_CARGOS",
      deudaVencida: false, entregadoEn: row.entregado_en ?? null, calculadoEn: row.calculado_en,
    };
  }
  return result;
}

export function createOracleOrderQueries({ poolManager, schema, driver = oracledb }) {
  const execute = createOracleQueryExecutor({ poolManager, schema, driver });
  return Object.freeze({
    async listOrders(input) {
      const procedure = `pkg_consultas_ordenes.listar_${input.view.toLowerCase()}`;
      const rows = await execute(procedure, {
        actorId: input.actorId, sessionId: input.sessionId, from: input.from ?? null,
        until: input.until ?? null, state: input.state ?? null, purpose: input.purpose ?? null,
        vehicleId: input.vehicleId ?? null,
        active: input.active === undefined ? null : Number(input.active),
        afterDate: input.after?.date ?? null, afterId: input.after?.id ?? null,
        maximum: input.limit + 1,
      }, input.limit + 1);
      return rows.map((row) => ({ ...projected(row, input.view), _position: { date: row.posicion_fecha, id: row.posicion_id } }));
    },
    async getOrder(input) {
      const procedure = `pkg_consultas_ordenes.consultar_${input.view.toLowerCase()}`;
      const rows = await execute(procedure, {
        actorId: input.actorId, sessionId: input.sessionId, orderId: input.orderId,
      }, 1);
      return rows.length === 0 ? null : projected(rows[0], input.view);
    },
  });
}
