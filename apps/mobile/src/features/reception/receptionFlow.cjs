function assertCurrentVehicle(vehicle, customerId) {
  if (!vehicle?.activo || vehicle.propiedadActual?.clienteId !== customerId || !vehicle.propiedadActual?.id) {
    const error = new Error("La propiedad del vehículo cambió. Vuelve a seleccionar el vehículo.");
    error.code = "PROPIEDAD_CAMBIADA";
    throw error;
  }
  if (vehicle.ordenActivaId) {
    const error = new Error("Este vehículo ya tiene una atención activa.");
    error.code = "ORDEN_ACTIVA_EXISTENTE";
    throw error;
  }
  return {
    vehiculoId: vehicle.id,
    propiedadEsperadaId: vehicle.propiedadActual.id,
    propietarioEsperadoId: vehicle.propiedadActual.clienteId,
  };
}

function validateReception({ kilometrajeIngreso, motivoIngreso, danosVisibles, photo }) {
  const km = kilometrajeIngreso.trim();
  if (!/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9])?$/.test(km)) {
    throw new Error("Ingresa un kilometraje válido, con hasta un decimal.");
  }
  if (!motivoIngreso.trim() || motivoIngreso.length > 2000 || !danosVisibles.trim() || danosVisibles.length > 2000) {
    throw new Error("Describe el motivo y los daños visibles. Si no hay daños, indícalo expresamente.");
  }
  if (!photo?.uri) throw new Error("Toma o selecciona una fotografía de recepción.");
  return { km, motivo: motivoIngreso.trim(), danos: danosVisibles.trim() };
}

function createReceptionFlow({ repository, uuid }) {
  let pending = null;
  let confirmedOrderId = null;
  let busy = false;
  return Object.freeze({
    get hasPending() { return pending !== null || confirmedOrderId !== null; },
    reset() { pending = null; confirmedOrderId = null; },
    async submit({ customerId, vehicleId, kilometrajeIngreso, motivoIngreso, danosVisibles, photo }) {
      if (busy) return null;
      busy = true;
      try {
        if (!pending && !confirmedOrderId) {
          const input = validateReception({ kilometrajeIngreso, motivoIngreso, danosVisibles, photo });
          const current = assertCurrentVehicle(await repository.getVehicle(vehicleId), customerId);
          let receipt;
          try { receipt = await repository.upload(photo, current); }
          catch (error) {
            error.receptionStep = "E01";
            if (error.status !== undefined) console.warn("E01 upload failed", {
              status: error.status, code: error.code ?? null,
              requestId: error.requestId ?? null, transportCause: error.transportCause ?? null,
            });
            throw error;
          }
          const body = {
            ...current,
            kilometrajeIngreso: input.km,
            motivoIngreso: input.motivo,
            danosVisibles: input.danos,
            evidenciasRecepcion: [{ recibo: receipt, descripcion: "Fotografía de recepción" }],
          };
          pending = { key: uuid(), body };
        }
        if (!confirmedOrderId) {
          try {
            const opened = await repository.open(pending.body, pending.key);
            confirmedOrderId = opened.ordenId;
          } catch (error) {
            if (!error.uncertain) pending = null;
            throw error;
          }
        }
        const detail = await repository.getOrder(confirmedOrderId);
        if (detail?.id !== confirmedOrderId) throw new Error("No se pudo verificar la orden creada.");
        pending = null;
        confirmedOrderId = null;
        return detail;
      } finally { busy = false; }
    },
  });
}

module.exports = { assertCurrentVehicle, validateReception, createReceptionFlow };
