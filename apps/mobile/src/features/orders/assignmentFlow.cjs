// O06/O07 are K commands (API contract §2.5/§2.6). One human intention = one key and one
// frozen body, created before the first send. While the result is unknown the intention
// stays pending: the form is locked and the only action is verifying with the same key.
const { createCommandIntent } = require("../../api/commandIntent.cjs");

const MAX_REASON = 500;

function localError(message) {
  return Object.assign(new Error(message), { code: "VALIDACION_LOCAL" });
}

function reasonOf(value) {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason || [...reason].length > MAX_REASON) {
    throw localError(`Escribe un motivo de hasta ${MAX_REASON} caracteres.`);
  }
  return reason;
}

function orderPath(orderId) {
  return `/interno/ordenes/${encodeURIComponent(orderId)}`;
}

// Phases: IDLE → ENVIANDO → CONFIRMADO | RECHAZADO | DESCONOCIDO (→ ENVIANDO on verify).
// SIN_VERIFICAR: the server refused the replay because it belongs to another session
// (CLAVE_REUTILIZADA); the participant list, not the key, says what happened.
function createAssignmentFlow({ request, uuid }) {
  const intent = createCommandIntent({ request, uuid });
  let phase = "IDLE";
  let kind = null;
  let lastError = null;
  let lastResult = null;

  async function send(nextKind, path, body) {
    if (phase === "ENVIANDO") return null;
    if (intent.pending && kind !== nextKind) {
      throw localError("Primero verifica el resultado pendiente.");
    }
    const retrying = intent.pending;
    kind = nextKind;
    phase = "ENVIANDO";
    lastError = null;
    try {
      lastResult = await intent.run(path, body);
      phase = "CONFIRMADO";
      return lastResult;
    } catch (error) {
      lastError = error;
      if (error.uncertain) phase = "DESCONOCIDO";
      else if (retrying && error.code === "CLAVE_REUTILIZADA") phase = "SIN_VERIFICAR";
      else phase = "RECHAZADO";
      throw error;
    }
  }

  return Object.freeze({
    get phase() { return phase; },
    get kind() { return kind; },
    get error() { return lastError; },
    get result() { return lastResult; },
    // True while an intention with an unknown result locks the form.
    get locked() { return phase === "ENVIANDO" || intent.pending; },
    assign(orderId, mechanicId, reason) {
      // A pending intention is retried with its own frozen body, never with new input.
      if (intent.pending) return send("ASIGNAR", null, null);
      if (!mechanicId) throw localError("Selecciona un mecánico elegible.");
      return send("ASIGNAR", `${orderPath(orderId)}/asignar-mecanico`,
        { mecanicoId: String(mechanicId), motivo: reasonOf(reason) });
    },
    retire(orderId, participationId, reason) {
      if (intent.pending) return send("RETIRAR", null, null);
      return send("RETIRAR",
        `${orderPath(orderId)}/participaciones/${encodeURIComponent(participationId)}/retirar`,
        { motivo: reasonOf(reason) });
    },
    verify() {
      if (!intent.pending) return Promise.resolve(null);
      return send(kind, null, null);
    },
    // Leaves a confirmed/rejected/unverifiable outcome; an unknown one cannot be dismissed.
    acknowledge() {
      if (intent.pending || phase === "ENVIANDO") return false;
      phase = "IDLE"; kind = null; lastError = null; lastResult = null;
      return true;
    },
  });
}

module.exports = { MAX_REASON, createAssignmentFlow };
