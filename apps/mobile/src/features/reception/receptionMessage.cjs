function receptionMessage(error) {
  const messages = {
    PROPIEDAD_CAMBIADA: "La propiedad del vehículo cambió. Vuelve a seleccionar el vehículo.",
    ORDEN_ACTIVA_EXISTENTE: "Este vehículo ya tiene una atención activa.",
    DEUDA_NO_VERIFICABLE: "No se puede abrir la recepción. Se requiere revisión administrativa.",
    EVIDENCIA_NO_APLICABLE: "La fotografía preparada ya no es válida o venció. Prepárala de nuevo.",
    EVIDENCIA_REQUERIDA: "Prepara la fotografía de recepción antes de confirmar.",
    RECIBO_VENCIDO: "La evidencia preparada venció. Prepárala de nuevo.",
    PHOTO_FORMAT_UNSUPPORTED: "El formato de la fotografía no es admitido. Usa JPEG o PNG.",
  };
  if (messages[error.code]) return messages[error.code];
  if (error.code === "VALIDACION_LOCAL") return error.message;
  if (error.status === 413) return "La fotografía es demasiado grande. Toma otra con menor resolución.";
  if (error.status === 415) return "El formato de la fotografía no es admitido. Usa JPEG o PNG.";
  if (error.status === 403) return "Tu acceso ya no permite crear recepciones.";
  if (error.receptionStep === "E01") return "No se pudo cargar la fotografía. Comprueba la conexión y vuelve a intentar.";
  if (error.uncertain) return "Resultado desconocido: la orden pudo haberse creado. Pulsa verificar para consultar esta misma recepción; no se creará otra.";
  return error.status ? "No se pudo completar la recepción. Revisa los datos y vuelve a intentar." : error.message;
}

module.exports = { receptionMessage };
