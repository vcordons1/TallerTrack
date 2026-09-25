import oracledb from "oracledb";

import { createOracleQueryExecutor } from "../../platform/oracle-query.js";

function vehicle(row) {
  return {
    id: row.id,
    tipoVehiculo: row.tipo_vehiculo,
    placa: row.placa ?? null,
    vin: row.vin ?? null,
    marca: row.marca,
    modelo: row.modelo,
    anio: row.anio ?? null,
    color: row.color ?? null,
    activo: row.activo === 1,
    version: row.version,
    propiedadActual: {
      id: row.propiedad_id,
      clienteId: row.cliente_id,
      nombreCliente: row.nombre_cliente,
      desdeEn: row.propiedad_desde_en,
    },
    qr: {
      generacionId: row.qr_id ?? null,
      estado: row.qr_estado,
      emitidoEn: row.qr_emitido_en ?? null,
      expiraEn: row.qr_expira_en ?? null,
    },
    ordenActivaId: row.orden_activa_id ?? null,
  };
}

export function createOracleCustomerVehicleQueries({ poolManager, schema, driver = oracledb }) {
  const execute = createOracleQueryExecutor({ poolManager, schema, driver });
  return Object.freeze({
    async listCustomers(input) {
      const rows = await execute("pkg_consultas_clientes_vehiculos.listar_clientes", {
        actorId: input.actorId, sessionId: input.sessionId, q: input.q ?? null,
        active: input.active === undefined ? null : Number(input.active),
        afterDate: input.after?.date ?? null, afterId: input.after?.id ?? null,
        maximum: input.limit + 1,
      }, input.limit + 1);
      return rows.map((row) => ({
        id: row.id, version: row.version, nombre: row.nombre,
        telefono: row.telefono ?? null, email: row.email ?? null,
        direccion: row.direccion ?? null, nit: row.nit ?? null,
        activo: row.activo === 1, accesoDigital: row.acceso_digital,
        _position: { date: row.posicion_fecha, id: row.posicion_id },
      }));
    },
    async listVehicles(input) {
      const rows = await execute("pkg_consultas_clientes_vehiculos.listar_vehiculos", {
        actorId: input.actorId, sessionId: input.sessionId, q: input.q ?? null,
        clientId: input.clientId ?? null,
        active: input.active === undefined ? null : Number(input.active),
        afterDate: input.after?.date ?? null, afterId: input.after?.id ?? null,
        maximum: input.limit + 1,
      }, input.limit + 1);
      return rows.map((row) => ({ ...vehicle(row), _position: { date: row.posicion_fecha, id: row.posicion_id } }));
    },
    async getVehicle(input) {
      const rows = await execute("pkg_consultas_clientes_vehiculos.consultar_vehiculo", {
        actorId: input.actorId, sessionId: input.sessionId, vehicleId: input.vehicleId,
      }, 1);
      return rows.length === 0 ? null : vehicle(rows[0]);
    },
  });
}
