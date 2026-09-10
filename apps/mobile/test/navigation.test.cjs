const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CAPABILITIES,
  ROLES,
  deriveInternalCapabilities,
  getAuthenticatedRoot,
  getInternalDestinations,
  hasInternalCapability,
} = require("../src/navigation/accessPolicy");

test("an administrator does not inherit operational workspaces", () => {
  const capabilities = deriveInternalCapabilities([ROLES.ADMINISTRADOR]);

  assert.equal(capabilities.has(CAPABILITIES.ADMIN_DASHBOARD), true);
  assert.equal(capabilities.has(CAPABILITIES.ORDERS_READ), true);
  assert.equal(capabilities.has(CAPABILITIES.AGENDA_WORKSPACE), true);
  assert.equal(capabilities.has(CAPABILITIES.MANAGEMENT_WORKSPACE), true);
  assert.equal(capabilities.has(CAPABILITIES.ORDERS_WORKSPACE), false);
  assert.equal(capabilities.has(CAPABILITIES.INVENTORY_WORKSPACE), false);
});

test("order reading is broader than the operational orders tab", () => {
  assert.equal(
    hasInternalCapability([ROLES.ADMINISTRADOR], CAPABILITIES.ORDERS_READ),
    true,
  );
  assert.equal(
    getInternalDestinations([ROLES.ADMINISTRADOR]).some(({ key }) => key === "orders"),
    false,
  );
  assert.equal(
    hasInternalCapability([], CAPABILITIES.ORDERS_READ),
    false,
  );
});

test("the administrative Dashboard is isolated from non-administrator actors", () => {
  assert.equal(
    hasInternalCapability([ROLES.ADMINISTRADOR], CAPABILITIES.ADMIN_DASHBOARD),
    true,
  );
  assert.equal(
    hasInternalCapability([ROLES.RECEPCIONISTA], CAPABILITIES.ADMIN_DASHBOARD),
    false,
  );
  assert.equal(
    hasInternalCapability([ROLES.MECANICO], CAPABILITIES.ADMIN_DASHBOARD),
    false,
  );
  assert.equal(
    hasInternalCapability([ROLES.INVENTARIO], CAPABILITIES.ADMIN_DASHBOARD),
    false,
  );
});

test("multiple internal roles compose their destinations", () => {
  const destinations = getInternalDestinations([
    ROLES.RECEPCIONISTA,
    ROLES.INVENTARIO,
  ]).map(({ key }) => key);

  assert.deepEqual(destinations, [
    "home",
    "orders",
    "agenda",
    "inventory",
    "management",
  ]);
});

test("a mechanic only receives home and orders", () => {
  const destinations = getInternalDestinations([ROLES.MECANICO]).map(
    ({ key }) => key,
  );

  assert.deepEqual(destinations, ["home", "orders"]);
});

test("authenticated actor type selects a separate shell", () => {
  assert.equal(getAuthenticatedRoot({ tipoActor: "INTERNO" }), "/interno");
  assert.equal(getAuthenticatedRoot({ tipoActor: "CLIENTE" }), "/cliente");
  assert.equal(getAuthenticatedRoot(null), "/acceso/iniciar-sesion");
});
