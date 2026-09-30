import express from "express";
import { randomUUID } from "node:crypto";
import { requireAnyRole } from "./identity-service.js";
import { parseStrictJsonObject } from "../../platform/strict-json.js";
import { OperationalQueryError, optionalTextQuery, optionalBooleanQuery, optionalEnumQuery,
  parseListQuery, positiveId, pageRows } from "../../platform/operational-query-contract.js";

const ROLES = ["ADMINISTRADOR", "RECEPCIONISTA", "MECANICO", "INVENTARIO"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => { throw new OperationalQueryError("SOLICITUD_INVALIDA", "Invalid user request"); };
const route = (fn) => (req, res, next) => { Promise.resolve(fn(req, res)).catch(next); };
function text(value, maximum) {
  if (typeof value !== "string" || !value.trim() || [...value].length > maximum) invalid();
  return value.trim();
}
function readBody(req, operation) {
  if (Object.keys(req.query).length || !req.is("application/json")) invalid();
  let b;
  try { b = parseStrictJsonObject(req.body); } catch { invalid(); }
  const fields = operation === "I11" ? ["login", "nombreMostrado", "roles", "password"]
    : operation === "I13" ? ["versionEsperada", "roles", "motivo"] : ["versionEsperada", "motivo"];
  if (Object.keys(b).length !== fields.length || fields.some((f) => !Object.hasOwn(b, f))) invalid();
  if (operation !== "I14") {
    if (!Array.isArray(b.roles)) invalid();
    if (!b.roles.length) throw new OperationalQueryError("ROL_REQUERIDO", "A role is required");
    if (b.roles.some((r) => !ROLES.includes(r)) || new Set(b.roles).size !== b.roles.length) invalid();
    b.roles = [...b.roles].sort();
  }
  if (operation === "I11") {
    b.login = text(b.login, 150).normalize("NFKC").toLowerCase();
    if (b.login.length > 150) invalid();
    b.nombreMostrado = text(b.nombreMostrado, 200);
    // Same supported password domain as the existing bootstrap; no composition rules.
    if (typeof b.password !== "string" || b.password.length < 12 || b.password.length > 128) invalid();
  } else {
    if (typeof b.versionEsperada !== "string" || !/^[1-9][0-9]{0,9}$/.test(b.versionEsperada)) invalid();
    b.motivo = text(b.motivo, 500);
  }
  return b;
}
export function createInternalUsersHttp({ requireAuthenticated, repository, cursorCodec }) {
  const router = express.Router();
  const base = "/interno/usuarios";
  router.use(base, requireAuthenticated, requireAnyRole("ADMINISTRADOR"));
  const meta = (req) => ({ requestId: req.requestId, generadoEn: new Date().toISOString() });
  const actor = (req) => ({ actorId: req.auth.userId, sessionId: req.auth.sessionId });
  router.get(base, route(async (req, res) => {
    const { cursor, limit } = parseListQuery(req.query, ["q", "activo", "rol"]);
    const filters = { q: optionalTextQuery(req.query, "q") ?? null,
      active: optionalBooleanQuery(req.query, "activo") ?? null,
      role: optionalEnumQuery(req.query, "rol", ROLES) ?? null };
    const context = { audience: { operation: "I10", actorId: req.auth.userId }, filters, order: "created:desc,id:desc" };
    const position = cursor ? cursorCodec.decode(cursor, context) : null;
    const rows = await repository.read({ ...actor(req), ...filters, position, limit });
    res.json({ ...pageRows({ rows, limit, cursorCodec, cursorContext: context }), meta: meta(req) });
  }));
  router.get(`${base}/:id`, route(async (req, res) => {
    if (Object.keys(req.query).length) invalid();
    const [row] = await repository.read({ ...actor(req), id: positiveId(req.params.id), limit: 1 });
    if (!row) throw new OperationalQueryError("RECURSO_NO_ENCONTRADO", "User not found");
    const { _position, ...data } = row;
    res.json({ data, meta: meta(req) });
  }));
  for (const [operation, path] of [["I11", base], ["I13", `${base}/:id/cambiar-roles`], ["I14", `${base}/:id/desactivar`]]) {
    router.post(path, express.text({ type: "application/json", limit: "16kb" }), route(async (req, res) => {
      const key = req.get("Idempotency-Key");
      if (!key) throw new OperationalQueryError("CLAVE_REQUERIDA", "A key is required");
      if (!UUID.test(key)) invalid();
      const correlation = req.get("X-Correlation-ID");
      if (correlation && !UUID.test(correlation)) invalid();
      const result = await repository.command({ ...actor(req), operation,
        id: operation === "I11" ? null : positiveId(req.params.id), body: readBody(req, operation),
        key: key.toLowerCase(), correlationId: correlation || randomUUID() });
      if (operation === "I11") res.location(`${base.replace('/interno', '/api/v1/interno')}/${result.data.usuarioId}`);
      res.status(operation === "I11" ? 201 : 200).json({ data: result.data, meta: { ...meta(req),
        repetido: result.repeated, comandoId: result.commandId, confirmadoEn: result.confirmedAt } });
    }));
  }
  return router;
}
