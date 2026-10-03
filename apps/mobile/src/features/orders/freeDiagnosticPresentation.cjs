// TT-029 free-diagnostic presentation: which actions a technical reader may attempt
// (the server still decides) and the user-facing outcome of T02/T04/D02.

// Contract field limits (api-contract §4.5).
const LIMITS = Object.freeze({ descripcion: 1500, motivo: 1000, detalleTecnico: 10000, resumenCliente: 2000 });

const ACTIVE_STATES = ["PROPUESTO", "EN_EJECUCION"];
const isFreeDiagnosis = (work) => work.tipo === "DIAGNOSTICO" && work.diagnosticoGratuito === true;

// One active free diagnosis at a time keeps the demo free of accidental duplicates.
// A confirmed report hides the D02 form: new revisions are allowed by the server but out of TT-029.
function freeDiagnosticActions({ order, works, diagnoses }) {
  const operative = order.proposito === "COMERCIAL" && ["RECIBIDO", "EN_DIAGNOSTICO"].includes(order.estado);
  const active = works.filter((work) => isFreeDiagnosis(work) && ACTIVE_STATES.includes(work.estado));
  const proposed = active.find((work) => work.estado === "PROPUESTO") || null;
  const running = active.find((work) => work.estado === "EN_EJECUCION") || null;
  const reported = running ? diagnoses.some((item) => item.trabajoDiagnosticoId === running.id) : false;
  return {
    canPropose: operative && active.length === 0,
    toStart: operative ? proposed : null,
    toConfirm: running && order.estado === "EN_DIAGNOSTICO" && !reported ? running : null,
  };
}

const ACTION = { propose: "la propuesta", start: "el inicio", confirm: "el informe" };

const COMMON = {
  VERSION_DESACTUALIZADA: "Otra persona cambió este trabajo. Se actualizó la información; revísala y vuelve a intentar.",
  ALCANCE_NO_AUTORIZADO: "En esta etapa solo se puede ejecutar un diagnóstico gratuito explícito.",
  ACCION_NO_PERMITIDA: "Tu acceso actual no permite esta acción: confirma que sigues asignado a la orden y que tienes rol de mecánico.",
  RECURSO_NO_ENCONTRADO: "La orden o el trabajo ya no está disponible. Se actualizó la información.",
  CLAVE_REUTILIZADA: "No se pudo verificar el envío anterior con esta sesión. Actualiza la orden antes de repetirlo.",
  EVIDENCIA_NO_APLICABLE: "Las evidencias todavía no se pueden adjuntar al informe.",
  SOLICITUD_INVALIDA: "Revisa los datos escritos y vuelve a intentar.",
  CLAVE_REQUERIDA: "Falta la clave del envío. Vuelve a intentar.",
};

const STATE = {
  propose: "La orden ya no admite trabajos nuevos en su estado actual.",
  start: "El trabajo ya no está propuesto (quizá ya se inició) o la orden cambió de estado. Se actualizó la información.",
  confirm: "No se puede confirmar: el trabajo debe estar iniciado y la orden en diagnóstico. Se actualizó la información.",
};

// Server code is shown next to the text so a demo or a support call can identify the rejection.
function freeDiagnosticMessage(error, kind) {
  if (error.uncertain) {
    return `Resultado desconocido: ${ACTION[kind] || "el envío"} pudo haberse registrado. `
      + "Usa «Verificar este mismo envío»; no se duplicará.";
  }
  const text = error.code === "ESTADO_INCOMPATIBLE" ? STATE[kind] || STATE.start : COMMON[error.code];
  if (text) return `${text} (${error.code})`;
  if (error.status === 0) return "No hay conexión con el servidor. Comprueba la red y vuelve a intentar.";
  if (error.status === 400) return "Revisa los datos escritos y vuelve a intentar.";
  if (error.status === 403) return COMMON.ACCION_NO_PERMITIDA;
  return error.code ? `No se pudo completar la acción (${error.code}).` : "No se pudo completar la acción. Vuelve a intentar.";
}

// Rejections after which the screen must re-read the order and its works.
function needsReload(error) {
  return !error.uncertain && ["VERSION_DESACTUALIZADA", "ESTADO_INCOMPATIBLE", "RECURSO_NO_ENCONTRADO",
    "CLAVE_REUTILIZADA"].includes(error.code);
}

function loadMessage(error) {
  if (error.status === 403 || error.status === 404) return "Tu acceso actual no permite consultar los trabajos de esta orden.";
  if (error.status === 0) return "No hay conexión con el servidor. Comprueba la red y vuelve a intentar.";
  return "No se pudieron consultar los trabajos y diagnósticos.";
}

module.exports = { LIMITS, freeDiagnosticActions, freeDiagnosticMessage, loadMessage, needsReload };
