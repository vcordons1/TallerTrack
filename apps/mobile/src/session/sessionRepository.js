export async function resolveInitialSession() {
  // G-01 keeps real authentication out of this sprint. This explicit demo
  // identity makes the ADMINISTRADOR-only presentation path reachable while
  // preserving SessionProvider as the future /acceso/yo integration boundary.
  return {
    tipoActor: "INTERNO",
    clienteId: null,
    nombreMostrado: "Sofía Herrera",
    roles: ["ADMINISTRADOR"],
  };
}
