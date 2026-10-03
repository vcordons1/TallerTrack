// User-facing outcome of O06/O07. An unknown result is never reported as a failure:
// the participation may already exist on the server.
function assignmentMessage(error, kind) {
  const assign = kind === "ASIGNAR";
  if (error.code === "VALIDACION_LOCAL") return error.message;
  if (error.uncertain) {
    return assign
      ? "Resultado desconocido: la asignación pudo haberse registrado. Verifica esta misma asignación; no se creará otra."
      : "Resultado desconocido: el retiro pudo haberse registrado. Verifica este mismo retiro; no se repetirá.";
  }
  const messages = {
    REFERENCIA_DUPLICADA: "Ese mecánico ya participa en esta orden.",
    ROL_REQUERIDO: "La persona elegida ya no es un mecánico activo. Actualiza la lista de elegibles.",
    ESTADO_INCOMPATIBLE: assign
      ? "La orden ya no admite asignaciones en su estado actual."
      : "La participación ya estaba retirada o la orden no admite retiros. Se actualizó la lista.",
    ACCION_NO_PERMITIDA: "Tu acceso actual no permite coordinar mecánicos en esta orden.",
    RECURSO_NO_ENCONTRADO: "La orden o la participación ya no está disponible.",
    CLAVE_REUTILIZADA: "No se pudo verificar el envío anterior con esta sesión. Revisa la lista de participantes antes de repetirlo.",
  };
  if (messages[error.code]) return messages[error.code];
  if (error.status === 400) return "Revisa el motivo y vuelve a intentar.";
  return error.message || "No se pudo completar la acción.";
}

module.exports = { assignmentMessage };
