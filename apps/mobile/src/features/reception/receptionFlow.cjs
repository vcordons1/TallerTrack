// Reception is two separate human steps: E01 prepares a temporary private file (never
// an order) and O02 confirms the reception. Only O02 + a verifying O03 means "RECIBIDO".
const NO_DAMAGE_TEXT = "Sin daños visibles";
// A receipt about to expire is prepared again instead of being sent to fail.
const EXPIRY_MARGIN_MS = 5000;

function flowError(code, message) {
  return Object.assign(new Error(message), { code });
}

function assertCurrentVehicle(vehicle, customerId) {
  if (!vehicle?.activo || vehicle.propiedadActual?.clienteId !== customerId || !vehicle.propiedadActual?.id) {
    throw flowError("PROPIEDAD_CAMBIADA", "La propiedad del vehículo cambió. Vuelve a seleccionar el vehículo.");
  }
  if (vehicle.ordenActivaId) {
    const error = flowError("ORDEN_ACTIVA_EXISTENTE", "Este vehículo ya tiene una atención activa.");
    error.details = { ordenId: vehicle.ordenActivaId };
    throw error;
  }
  return {
    vehiculoId: vehicle.id,
    propiedadEsperadaId: vehicle.propiedadActual.id,
    propietarioEsperadoId: vehicle.propiedadActual.clienteId,
  };
}

function sameContext(left, right) {
  return left.vehiculoId === right.vehiculoId && left.propiedadEsperadaId === right.propiedadEsperadaId
    && left.propietarioEsperadoId === right.propietarioEsperadoId;
}

function validateReception({ kilometrajeIngreso, motivoIngreso, danosVisibles }) {
  const km = kilometrajeIngreso.trim();
  if (!/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9])?$/.test(km)) {
    throw flowError("VALIDACION_LOCAL", "Ingresa un kilometraje válido, con hasta un decimal.");
  }
  if (!motivoIngreso.trim() || motivoIngreso.length > 2000 || !danosVisibles.trim() || danosVisibles.length > 2000) {
    throw flowError("VALIDACION_LOCAL", "Describe el motivo y los daños visibles. Si no hay daños, indícalo expresamente.");
  }
  return { km, motivo: motivoIngreso.trim(), danos: danosVisibles.trim() };
}

function createReceptionFlow({ repository, uuid, now = () => Date.now() }) {
  let prepared = null;
  let pending = null;
  let confirmedOrderId = null;
  let phase = "EDITANDO";
  let busy = false;

  async function exclusive(work) {
    if (busy) return null;
    busy = true;
    try { return await work(); } finally { busy = false; }
  }

  function expired() {
    const expiresAt = Date.parse(prepared?.expiresAt ?? "");
    return !Number.isFinite(expiresAt) || expiresAt - EXPIRY_MARGIN_MS <= now();
  }

  return Object.freeze({
    // PREPARANDO → PREPARADA → ENVIANDO → (INCIERTO | VERIFICANDO) → EDITANDO after success.
    get phase() { return phase; },
    get prepared() { return prepared === null ? null : { expiresAt: prepared.expiresAt, context: prepared.context }; },
    // An O02 intention whose result is not yet known/verified locks the form and its key.
    get hasPending() { return pending !== null || confirmedOrderId !== null; },
    reset() {
      if (pending !== null || confirmedOrderId !== null) return;
      prepared = null;
      phase = "EDITANDO";
    },
    prepare({ customerId, vehicleId, photo }) {
      return exclusive(async () => {
        if (pending !== null || confirmedOrderId !== null) return null;
        if (!photo?.uri) throw flowError("VALIDACION_LOCAL", "Toma o selecciona una fotografía de recepción.");
        prepared = null;
        phase = "PREPARANDO";
        try {
          const context = assertCurrentVehicle(await repository.getVehicle(vehicleId), customerId);
          let upload;
          try { upload = await repository.upload(photo, context); }
          catch (error) {
            error.receptionStep = "E01";
            if (error.status !== undefined) console.warn("E01 upload failed", {
              status: error.status, code: error.code ?? null,
              requestId: error.requestId ?? null, transportCause: error.transportCause ?? null,
            });
            throw error;
          }
          prepared = { receipt: upload.recibo, expiresAt: upload.expiraEn, context };
          phase = "PREPARADA";
          return { expiresAt: upload.expiraEn, context };
        } catch (error) {
          phase = "EDITANDO";
          throw error;
        }
      });
    },
    submit({ customerId, vehicleId, kilometrajeIngreso, motivoIngreso, danosVisibles }) {
      return exclusive(async () => {
        if (pending === null && confirmedOrderId === null) {
          const input = validateReception({ kilometrajeIngreso, motivoIngreso, danosVisibles });
          if (prepared === null) throw flowError("EVIDENCIA_REQUERIDA", "Prepara la fotografía de recepción antes de confirmar.");
          if (expired()) {
            prepared = null;
            phase = "EDITANDO";
            throw flowError("RECIBO_VENCIDO", "La evidencia preparada venció. Prepárala de nuevo.");
          }
          const current = assertCurrentVehicle(await repository.getVehicle(vehicleId), customerId);
          if (!sameContext(current, prepared.context)) {
            prepared = null;
            phase = "EDITANDO";
            throw flowError("PROPIEDAD_CAMBIADA", "La propiedad del vehículo cambió. Vuelve a seleccionar el vehículo.");
          }
          // One human intention: its key and exact body survive until the result is known.
          pending = {
            key: uuid(),
            body: {
              ...prepared.context,
              kilometrajeIngreso: input.km,
              motivoIngreso: input.motivo,
              danosVisibles: input.danos,
              evidenciasRecepcion: [{ recibo: prepared.receipt, descripcion: "Fotografía de recepción" }],
            },
          };
        }
        if (confirmedOrderId === null) {
          phase = "ENVIANDO";
          try {
            const opened = await repository.open(pending.body, pending.key);
            confirmedOrderId = opened.ordenId;
          } catch (error) {
            if (error.uncertain) {
              phase = "INCIERTO";
            } else {
              // A confirmed rejection: nothing was opened, so the intention ends here.
              pending = null;
              if (["EVIDENCIA_NO_APLICABLE", "EVIDENCIA_REQUERIDA", "PROPIEDAD_CAMBIADA"].includes(error.code)) {
                prepared = null;
                phase = "EDITANDO";
              } else {
                phase = prepared === null ? "EDITANDO" : "PREPARADA";
              }
            }
            throw error;
          }
        }
        phase = "VERIFICANDO";
        try {
          const detail = await repository.getOrder(confirmedOrderId);
          if (detail?.id !== confirmedOrderId) throw new Error("No se pudo verificar la orden creada.");
          pending = null;
          confirmedOrderId = null;
          prepared = null;
          phase = "EDITANDO";
          return detail;
        } catch (error) {
          phase = "INCIERTO";
          throw error;
        }
      });
    },
  });
}

module.exports = { NO_DAMAGE_TEXT, assertCurrentVehicle, validateReception, createReceptionFlow };
