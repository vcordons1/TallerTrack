const ROLES = Object.freeze({
  ADMINISTRADOR: "ADMINISTRADOR",
  RECEPCIONISTA: "RECEPCIONISTA",
  MECANICO: "MECANICO",
  INVENTARIO: "INVENTARIO",
  CLIENTE: "CLIENTE",
});

const ACTOR_TYPES = Object.freeze({
  INTERNAL: "INTERNO",
  CLIENT: "CLIENTE",
});

const CAPABILITIES = Object.freeze({
  INTERNAL_HOME: "INTERNAL_HOME",
  ORDERS_WORKSPACE: "ORDERS_WORKSPACE",
  AGENDA_WORKSPACE: "AGENDA_WORKSPACE",
  INVENTORY_WORKSPACE: "INVENTORY_WORKSPACE",
  MANAGEMENT_WORKSPACE: "MANAGEMENT_WORKSPACE",
  ADMIN_DASHBOARD: "ADMIN_DASHBOARD",
});

const INTERNAL_DESTINATIONS = Object.freeze([
  Object.freeze({
    key: "home",
    segment: "index",
    route: "/interno",
    title: "Inicio",
    icon: "home-outline",
    capability: CAPABILITIES.INTERNAL_HOME,
  }),
  Object.freeze({
    key: "orders",
    segment: "ordenes",
    route: "/interno/ordenes",
    title: "Órdenes",
    icon: "clipboard-text-outline",
    capability: CAPABILITIES.ORDERS_WORKSPACE,
  }),
  Object.freeze({
    key: "agenda",
    segment: "agenda",
    route: "/interno/agenda",
    title: "Agenda",
    icon: "calendar-blank-outline",
    capability: CAPABILITIES.AGENDA_WORKSPACE,
  }),
  Object.freeze({
    key: "inventory",
    segment: "inventario",
    route: "/interno/inventario",
    title: "Inventario",
    icon: "package-variant-closed",
    capability: CAPABILITIES.INVENTORY_WORKSPACE,
  }),
  Object.freeze({
    key: "management",
    segment: "gestion",
    route: "/interno/gestion",
    title: "Gestión",
    icon: "account-group-outline",
    capability: CAPABILITIES.MANAGEMENT_WORKSPACE,
  }),
]);

function deriveInternalCapabilities(roles = []) {
  const assignedRoles = new Set(roles);
  const capabilities = new Set([CAPABILITIES.INTERNAL_HOME]);

  if (
    assignedRoles.has(ROLES.RECEPCIONISTA) ||
    assignedRoles.has(ROLES.MECANICO) ||
    assignedRoles.has(ROLES.INVENTARIO)
  ) {
    capabilities.add(CAPABILITIES.ORDERS_WORKSPACE);
  }

  if (
    assignedRoles.has(ROLES.ADMINISTRADOR) ||
    assignedRoles.has(ROLES.RECEPCIONISTA)
  ) {
    capabilities.add(CAPABILITIES.AGENDA_WORKSPACE);
    capabilities.add(CAPABILITIES.MANAGEMENT_WORKSPACE);
  }

  if (assignedRoles.has(ROLES.INVENTARIO)) {
    capabilities.add(CAPABILITIES.INVENTORY_WORKSPACE);
  }

  if (assignedRoles.has(ROLES.ADMINISTRADOR)) {
    capabilities.add(CAPABILITIES.ADMIN_DASHBOARD);
  }

  return capabilities;
}

function getInternalDestinations(roles = []) {
  const capabilities = deriveInternalCapabilities(roles);
  return INTERNAL_DESTINATIONS.filter(({ capability }) =>
    capabilities.has(capability),
  );
}

function hasInternalCapability(roles = [], capability) {
  return deriveInternalCapabilities(roles).has(capability);
}

function canAccessInternalDestination(roles, destinationKey) {
  return getInternalDestinations(roles).some(
    ({ key }) => key === destinationKey,
  );
}

function getAuthenticatedRoot(access) {
  if (access?.tipoActor === ACTOR_TYPES.INTERNAL) {
    return "/interno";
  }

  if (access?.tipoActor === ACTOR_TYPES.CLIENT) {
    return "/cliente";
  }

  return "/acceso/iniciar-sesion";
}

module.exports = {
  ACTOR_TYPES,
  CAPABILITIES,
  INTERNAL_DESTINATIONS,
  ROLES,
  canAccessInternalDestination,
  deriveInternalCapabilities,
  getAuthenticatedRoot,
  getInternalDestinations,
  hasInternalCapability,
};
