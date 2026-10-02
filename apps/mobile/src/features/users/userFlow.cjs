const { createCommandIntent } = require("../../api/commandIntent.cjs");
const INTERNAL_ROLES = Object.freeze(["ADMINISTRADOR", "RECEPCIONISTA", "MECANICO", "INVENTARIO"]);
function validateUser(body) {
  if (!body.nombreMostrado?.trim() || body.nombreMostrado.length > 200) return "Ingresa el nombre (hasta 200 caracteres).";
  if (!body.login?.trim() || body.login.length > 150) return "Ingresa el usuario (hasta 150 caracteres).";
  if (!body.roles?.length || body.roles.some((role) => !INTERNAL_ROLES.includes(role))) return "Selecciona al menos un rol interno.";
  if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) return "La contraseña debe tener entre 12 y 128 caracteres.";
  return null;
}
function userError(error) {
  if (error.uncertain) return "No se conoce el resultado. Reintenta la misma operación antes de hacer cambios.";
  return ({ VERSION_DESACTUALIZADA: "Este usuario cambió. Recarga y revisa sus datos antes de decidir nuevamente.",
    ULTIMO_ADMINISTRADOR: "Debe quedar al menos un Administrador activo. Asigna ese rol a otra cuenta activa antes de retirarlo aquí.",
    REFERENCIA_DUPLICADA: "Ese usuario de acceso ya existe. Elige otro o búscalo en la lista.",
    ROL_REQUERIDO: "Selecciona al menos un rol interno.",
    CLAVE_REUTILIZADA: "La intención ya fue usada con otros datos. Revisa el usuario antes de continuar.",
    ACCION_NO_PERMITIDA: "Ya no tienes permiso para administrar usuarios.",
    ESTADO_INCOMPATIBLE: "La cuenta ya no está activa. Recarga su detalle.",
  })[error.code] || error.message || "No se pudo completar la operación.";
}
// TT-026 reuses the same K-intent semantics for customers and vehicles.
const createUserCommand = createCommandIntent;
module.exports = { INTERNAL_ROLES, validateUser, userError, createUserCommand };
