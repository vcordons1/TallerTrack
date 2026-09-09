const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SESSION_STATUS,
  initialSessionState,
  isValidAccess,
  sessionReducer,
} = require("../src/session/sessionState");

const internalAccess = {
  tipoActor: "INTERNO",
  clienteId: null,
  nombreMostrado: "Ada",
  roles: ["ADMINISTRADOR", "RECEPCIONISTA"],
};

const clientAccess = {
  tipoActor: "CLIENTE",
  clienteId: "42",
  nombreMostrado: "Lin",
  roles: ["CLIENTE"],
};

test("session starts loading and resolves without credentials", () => {
  assert.equal(initialSessionState.status, SESSION_STATUS.LOADING);

  assert.deepEqual(
    sessionReducer(initialSessionState, {
      type: "SESSION_RESOLVED",
      access: null,
    }),
    { status: SESSION_STATUS.UNAUTHENTICATED, access: null },
  );
});

test("valid client and multirole internal identities are accepted", () => {
  assert.equal(isValidAccess(internalAccess), true);
  assert.equal(isValidAccess(clientAccess), true);

  assert.equal(
    sessionReducer(initialSessionState, {
      type: "SESSION_RESOLVED",
      access: internalAccess,
    }).status,
    SESSION_STATUS.AUTHENTICATED,
  );
});

test("client and internal roles cannot be mixed", () => {
  assert.equal(
    isValidAccess({ ...internalAccess, roles: ["MECANICO", "CLIENTE"] }),
    false,
  );
  assert.equal(
    isValidAccess({ ...clientAccess, roles: ["CLIENTE", "RECEPCIONISTA"] }),
    false,
  );
});

test("unknown or duplicated internal roles are rejected", () => {
  assert.equal(isValidAccess({ ...internalAccess, roles: ["SUPERVISOR"] }), false);
  assert.equal(
    isValidAccess({
      ...internalAccess,
      roles: ["RECEPCIONISTA", "RECEPCIONISTA"],
    }),
    false,
  );
});
