import { randomUUID } from "node:crypto";

import express from "express";

import { IdentityError } from "../identity/identity-service.js";
import { parseStrictJsonObject } from "../../platform/strict-json.js";
import { OperationalQueryError, optionalBooleanQuery, pageRows, parseListQuery,
  positiveId } from "../../platform/operational-query-contract.js";
import { parseDeactivation, parseProfile, parseProfileChanges, parseTransfer,
  parseVehicleChanges, parseVehicleRegistration } from "./customer-vehicle-contract.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Customer/vehicle maintenance is an explicit A/R capability; nobody inherits it.
const ROLES = Object.freeze(["ADMINISTRADOR", "RECEPCIONISTA"]);

function invalid(message) { throw new OperationalQueryError("SOLICITUD_INVALIDA", message); }
function route(handler) { return (request, response, next) => { Promise.resolve(handler(request, response)).catch(next); }; }
function meta(request) { return { requestId: request.requestId, generadoEn: new Date().toISOString() }; }
function actor(request) { return { actorId: request.auth.userId, sessionId: request.auth.sessionId }; }
function noQuery(request) { if (Object.keys(request.query).length !== 0) invalid("Query parameters are not allowed"); }

function requireReception(request, _response, next) {
  if (!ROLES.some((role) => request.auth.roles.includes(role))) {
    next(new IdentityError("ACCION_NO_PERMITIDA", "The actor lacks customer/vehicle capability"));
    return;
  }
  next();
}

function jsonBody(request) {
  noQuery(request);
  if (!request.is("application/json")) invalid("Content-Type application/json is required");
  try { return parseStrictJsonObject(request.body); } catch { return invalid("Invalid JSON body"); }
}

function intent(request) {
  const key = request.get("Idempotency-Key");
  if (key === undefined) throw new OperationalQueryError("CLAVE_REQUERIDA", "Idempotency-Key is required");
  if (!UUID.test(key)) invalid("Idempotency-Key is invalid");
  return { key: key.toLowerCase(), correlationId: correlation(request) };
}

function correlation(request) {
  const value = request.get("X-Correlation-ID");
  if (value !== undefined && !UUID.test(value)) invalid("X-Correlation-ID is invalid");
  return value ?? randomUUID();
}

function commandResponse(request, response, status, result) {
  response.status(status).json({ data: result.data, meta: { ...meta(request),
    comandoId: result.commandId, confirmadoEn: result.confirmedAt, repetido: result.repeated } });
}

function found(value, message) {
  if (value === null) throw new OperationalQueryError("RECURSO_NO_ENCONTRADO", message);
  return value;
}

export function createCustomerVehicleHttp({ requireAuthenticated, queries, commands, cursorCodec }) {
  if (typeof requireAuthenticated !== "function" || !queries || !commands || !cursorCodec) {
    throw new TypeError("Customer/vehicle HTTP dependencies are invalid");
  }
  const router = express.Router();
  const json = express.text({ type: "application/json", limit: "16kb" });
  const guard = [requireAuthenticated, requireReception];

  router.get("/interno/tipos-vehiculo", ...guard, route(async (request, response) => {
    for (const key of Object.keys(request.query)) if (key !== "incluirInactivos") invalid("Unknown query parameter");
    const data = await queries.listVehicleTypes({ ...actor(request),
      includeInactive: optionalBooleanQuery(request.query, "incluirInactivos") ?? false });
    response.status(200).json({ data, meta: meta(request) });
  }));

  router.get("/interno/clientes/:id", ...guard, route(async (request, response) => {
    noQuery(request);
    const data = found(await queries.getCustomer({ ...actor(request), customerId: positiveId(request.params.id) }),
      "Customer was not found");
    response.status(200).json({ data, meta: meta(request) });
  }));

  router.post("/interno/clientes", ...guard, json, route(async (request, response) => {
    const profile = parseProfile(jsonBody(request));
    const result = await commands.registerCustomer({ ...actor(request), ...intent(request), profile });
    response.location(`/api/v1/interno/clientes/${result.data.clienteId}`);
    commandResponse(request, response, 201, result);
  }));

  router.patch("/interno/clientes/:id", ...guard, json, route(async (request, response) => {
    const customerId = positiveId(request.params.id);
    const { version, changes } = parseProfileChanges(jsonBody(request));
    await commands.updateCustomer({ ...actor(request), correlationId: correlation(request),
      customerId, version, changes });
    const data = found(await queries.getCustomer({ ...actor(request), customerId }), "Customer was not found");
    response.status(200).json({ data, meta: meta(request) });
  }));

  router.post("/interno/clientes/:id/desactivar", ...guard, json, route(async (request, response) => {
    const id = positiveId(request.params.id);
    const { version, reason } = parseDeactivation(jsonBody(request));
    const result = await commands.deactivate({ operation: "C05", ...actor(request), ...intent(request), id, version, reason });
    commandResponse(request, response, 200, result);
  }));

  router.post("/interno/vehiculos", ...guard, json, route(async (request, response) => {
    const registration = parseVehicleRegistration(jsonBody(request));
    const result = await commands.registerVehicle({ ...actor(request), ...intent(request), ...registration });
    response.location(`/api/v1/interno/vehiculos/${result.data.vehiculoId}`);
    commandResponse(request, response, 201, result);
  }));

  router.patch("/interno/vehiculos/:id", ...guard, json, route(async (request, response) => {
    const vehicleId = positiveId(request.params.id);
    const { version, changes } = parseVehicleChanges(jsonBody(request));
    await commands.updateVehicle({ ...actor(request), correlationId: correlation(request),
      vehicleId, version, changes });
    const data = found(await queries.getVehicle({ ...actor(request), vehicleId }), "Vehicle was not found");
    response.status(200).json({ data, meta: meta(request) });
  }));

  router.get("/interno/vehiculos/:id/propiedades", ...guard, route(async (request, response) => {
    const { cursor, limit } = parseListQuery(request.query, []);
    const vehicleId = positiveId(request.params.id);
    const context = { audience: { operation: "V05", actorId: request.auth.userId, vehicleId },
      filters: {}, order: "desdeEn:desc,id:desc" };
    const rows = await queries.listProperties({ ...actor(request), vehicleId, limit,
      after: cursor === undefined ? undefined : cursorCodec.decode(cursor, context) });
    response.status(200).json({ ...pageRows({ rows, limit, cursorCodec, cursorContext: context }), meta: meta(request) });
  }));

  router.post("/interno/vehiculos/:id/transferir-propietario", ...guard, json, route(async (request, response) => {
    const vehicleId = positiveId(request.params.id);
    const transfer = parseTransfer(jsonBody(request));
    const result = await commands.transferOwner({ ...actor(request), ...intent(request), vehicleId, transfer });
    commandResponse(request, response, 200, result);
  }));

  router.post("/interno/vehiculos/:id/desactivar", ...guard, json, route(async (request, response) => {
    const id = positiveId(request.params.id);
    const { version, reason } = parseDeactivation(jsonBody(request));
    const result = await commands.deactivate({ operation: "V07", ...actor(request), ...intent(request), id, version, reason });
    commandResponse(request, response, 200, result);
  }));

  return Object.freeze({ router });
}
