const { ACTOR_TYPES, ROLES } = require("../navigation/accessPolicy");

const SESSION_STATUS = Object.freeze({
  LOADING: "loading",
  UNAUTHENTICATED: "unauthenticated",
  AUTHENTICATED: "authenticated",
});

const initialSessionState = Object.freeze({
  status: SESSION_STATUS.LOADING,
  access: null,
});

const INTERNAL_ROLES = new Set([
  ROLES.ADMINISTRADOR,
  ROLES.RECEPCIONISTA,
  ROLES.MECANICO,
  ROLES.INVENTARIO,
]);

function isValidAccess(access) {
  if (!access || !Array.isArray(access.roles)) {
    return false;
  }

  if (access.tipoActor === ACTOR_TYPES.CLIENT) {
    return (
      access.clienteId != null &&
      access.roles.length === 1 &&
      access.roles[0] === ROLES.CLIENTE
    );
  }

  if (access.tipoActor === ACTOR_TYPES.INTERNAL) {
    return (
      access.clienteId == null &&
      access.roles.length > 0 &&
      new Set(access.roles).size === access.roles.length &&
      access.roles.every((role) => INTERNAL_ROLES.has(role))
    );
  }

  return false;
}

function sessionReducer(state, event) {
  switch (event.type) {
    case "SESSION_RESOLVED":
      if (!event.access) {
        return { status: SESSION_STATUS.UNAUTHENTICATED, access: null };
      }

      if (!isValidAccess(event.access)) {
        return { status: SESSION_STATUS.UNAUTHENTICATED, access: null };
      }

      return { status: SESSION_STATUS.AUTHENTICATED, access: event.access };
    case "SESSION_CLEARED":
      return { status: SESSION_STATUS.UNAUTHENTICATED, access: null };
    default:
      return state;
  }
}

module.exports = {
  SESSION_STATUS,
  initialSessionState,
  isValidAccess,
  sessionReducer,
};
