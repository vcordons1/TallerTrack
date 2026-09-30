import { randomUUID } from "node:crypto";

import express from "express";

import { IdentityError } from "../identity/identity-service.js";
import { parseStrictJsonObject } from "../../platform/strict-json.js";
import { OperationalQueryError, optionalBooleanQuery, optionalIdQuery,
  optionalTextQuery, pageRows, parseListQuery, positiveId } from "../../platform/operational-query-contract.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SERVICES = new Set(["MECANICA_GENERAL", "ELECTRICO", "AIRE_ACONDICIONADO",
  "DIAGNOSTICO", "MANTENIMIENTO_PREVENTIVO", "OTRO"]);
const DATE = "1970-01-01T00:00:00.000000Z";

function invalid(message) { throw new OperationalQueryError("SOLICITUD_INVALIDA", message); }
function route(handler) { return (request, response, next) => { Promise.resolve(handler(request, response)).catch(next); }; }
function role(request, roles) {
  if (!roles.some((value) => request.auth.roles.includes(value))) {
    throw new IdentityError("ACCION_NO_PERMITIDA", "The actor lacks this capability");
  }
}
function exact(body, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(body, key))
    || Object.keys(body).some((key) => !allowed.has(key))) invalid("Missing or unknown field");
}
function body(request, required, optional) {
  if (!request.is("application/json")) invalid("Content-Type application/json is required");
  let parsed;
  try { parsed = parseStrictJsonObject(request.body); } catch { invalid("Invalid JSON body"); }
  exact(parsed, required, optional);
  return parsed;
}
function fieldText(value, maximum, name) {
  if (typeof value !== "string" || value.trim() === "" || [...value].length > maximum) invalid(`${name} is invalid`);
  return value.trim();
}
function key(request) {
  const value = request.get("Idempotency-Key");
  if (value === undefined) throw new OperationalQueryError("CLAVE_REQUERIDA", "Idempotency-Key is required");
  if (!UUID.test(value)) invalid("Idempotency-Key is invalid");
  return value;
}
function commandInput(request, operation, orderId, material, fields) {
  return { operation, actorId: request.auth.userId, sessionId: request.auth.sessionId,
    orderId, material, idempotencyKey: key(request), correlationId: request.get("X-Correlation-ID") || randomUUID(),
    ...fields };
}
function commandResponse(request, response, status, result) {
  response.status(status).json({ data: result.data,
    meta: { requestId: request.requestId, generadoEn: new Date().toISOString(),
      comandoId: String(result.commandId), confirmadoEn: result.confirmedAt, repetido: result.repeated } });
}

export function createFreeDiagnosticHttp({ requireAuthenticated, repository, cursorCodec }) {
  if (typeof requireAuthenticated !== "function" || !repository || !cursorCodec) {
    throw new TypeError("Diagnostic HTTP dependencies are invalid");
  }
  const router = express.Router();
  const base = "/interno/ordenes/:id";
  const json = express.text({ type: "application/json", limit: "32kb" });

  async function listing(request, response, kind, allowedFilters, filters, roles) {
    role(request, roles);
    const { cursor, limit } = parseListQuery(request.query, allowedFilters);
    const orderId = positiveId(request.params.id);
    const context = { audience: { operation: kind, actorId: request.auth.userId, orderId },
      filters, order: "id:desc" };
    const afterId = cursor === undefined ? null : cursorCodec.decode(cursor, context).id;
    const rows = await repository.read(kind, { actorId: request.auth.userId,
      sessionId: request.auth.sessionId, orderId, afterId, limit, ...filters });
    const positioned = rows.map((item) => ({ ...item, _position: { date: DATE, id: item.id } }));
    response.status(200).json({ ...pageRows({ rows: positioned, limit, cursorCodec, cursorContext: context }),
      meta: { requestId: request.requestId, generadoEn: new Date().toISOString() } });
  }

  router.get("/interno/mecanicos", requireAuthenticated, route(async (request, response) => {
    role(request, ["RECEPCIONISTA", "MECANICO"]);
    const { cursor, limit } = parseListQuery(request.query, ["ordenId", "q"]);
    const orderId = optionalIdQuery(request.query, "ordenId");
    if (!orderId) invalid("ordenId is required");
    const q = optionalTextQuery(request.query, "q") ?? null;
    const context = { audience: { operation: "directory", actorId: request.auth.userId, orderId },
      filters: { q }, order: "id:desc" };
    const afterId = cursor === undefined ? null : cursorCodec.decode(cursor, context).id;
    const rows = await repository.read("directory", { actorId: request.auth.userId,
      sessionId: request.auth.sessionId, orderId, q, afterId, limit });
    response.status(200).json({ ...pageRows({ rows: rows.map((item) => ({ ...item,
      _position: { date: DATE, id: item.id } })), limit, cursorCodec, cursorContext: context }),
      meta: { requestId: request.requestId, generadoEn: new Date().toISOString() } });
  }));

  router.get(`${base}/mecanicos`, requireAuthenticated, route(async (request, response) => {
    const active = optionalBooleanQuery(request.query, "vigentes") ?? null;
    await listing(request, response, "participants", ["vigentes"], { active },
      ["ADMINISTRADOR", "RECEPCIONISTA", "MECANICO"]);
  }));
  router.get(`${base}/trabajos`, requireAuthenticated, route((request, response) =>
    listing(request, response, "works", [], {}, ["ADMINISTRADOR", "RECEPCIONISTA", "MECANICO"])));
  router.get(`${base}/diagnosticos`, requireAuthenticated, route((request, response) =>
    listing(request, response, "diagnoses", [], {}, ["ADMINISTRADOR", "RECEPCIONISTA", "MECANICO"])));

  router.post(`${base}/asignar-mecanico`, requireAuthenticated, json, route(async (request, response) => {
    role(request, ["RECEPCIONISTA", "MECANICO"]);
    const input = body(request, ["mecanicoId", "motivo"]);
    const orderId = positiveId(request.params.id);
    const destinationId = positiveId(input.mecanicoId, "mecanicoId");
    const reason = fieldText(input.motivo, 500, "motivo");
    const result = await repository.command(commandInput(request, "ASIGNAR_MECANICO", orderId,
      { destinationId, reason }, { destinationId, reason }));
    commandResponse(request, response, 201, result);
  }));
  router.post(`${base}/participaciones/:participationId/retirar`, requireAuthenticated, json,
    route(async (request, response) => {
      role(request, ["RECEPCIONISTA", "MECANICO"]);
      const input = body(request, ["motivo"]);
      const orderId = positiveId(request.params.id);
      const resourceId = positiveId(request.params.participationId);
      const reason = fieldText(input.motivo, 500, "motivo");
      const result = await repository.command(commandInput(request, "RETIRAR_MECANICO", orderId,
        { resourceId, reason }, { resourceId, reason }));
      commandResponse(request, response, 200, result);
    }));
  router.post(`${base}/trabajos`, requireAuthenticated, json, route(async (request, response) => {
    role(request, ["MECANICO"]);
    const input = body(request, ["tipo", "tipoServicio", "descripcion", "diagnosticoGratuito"]);
    if (input.tipo !== "DIAGNOSTICO" || input.diagnosticoGratuito !== true) {
      throw new OperationalQueryError("ALCANCE_NO_AUTORIZADO", "Only explicit free diagnosis is executable now");
    }
    if (!SERVICES.has(input.tipoServicio)) invalid("tipoServicio is invalid");
    const orderId = positiveId(request.params.id);
    const description = fieldText(input.descripcion, 1500, "descripcion");
    const material = { type: input.tipo, service: input.tipoServicio, description, free: true };
    const result = await repository.command(commandInput(request, "PROPONER_TRABAJO", orderId,
      material, { type: input.tipo, service: input.tipoServicio, description, free: 1 }));
    commandResponse(request, response, 201, result);
  }));
  router.post(`${base}/trabajos/:workId/iniciar`, requireAuthenticated, json,
    route(async (request, response) => {
      role(request, ["MECANICO"]);
      const input = body(request, ["versionEsperada", "motivo"]);
      const orderId = positiveId(request.params.id);
      const resourceId = positiveId(request.params.workId);
      const version = Number(positiveId(input.versionEsperada, "versionEsperada"));
      if (!Number.isSafeInteger(version) || version > 9999999999) invalid("versionEsperada is invalid");
      const reason = fieldText(input.motivo, 1000, "motivo");
      const result = await repository.command(commandInput(request, "INICIAR_TRABAJO", orderId,
        { resourceId, version, reason }, { resourceId, version, reason }));
      commandResponse(request, response, 200, result);
    }));
  router.post(`${base}/diagnosticos/confirmar`, requireAuthenticated, json,
    route(async (request, response) => {
      role(request, ["MECANICO"]);
      const input = body(request, ["trabajoDiagnosticoId", "detalleTecnico", "resumenCliente"], ["evidencias"]);
      if (input.evidencias !== undefined && (!Array.isArray(input.evidencias) || input.evidencias.length > 0)) {
        throw new OperationalQueryError("EVIDENCIA_NO_APLICABLE", "Technical evidence is not enabled in this increment");
      }
      const orderId = positiveId(request.params.id);
      const resourceId = positiveId(input.trabajoDiagnosticoId, "trabajoDiagnosticoId");
      const detail = fieldText(input.detalleTecnico, 10000, "detalleTecnico");
      const summary = fieldText(input.resumenCliente, 2000, "resumenCliente");
      const result = await repository.command(commandInput(request, "CONFIRMAR_DIAGNOSTICO", orderId,
        { resourceId, detail, summary }, { resourceId, detail, summary }));
      commandResponse(request, response, 201, result);
    }));
  return Object.freeze({ router });
}
