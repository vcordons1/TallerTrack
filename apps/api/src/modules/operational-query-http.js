import express from "express";

import { IdentityError } from "./identity/identity-service.js";
import {
  OperationalQueryError,
  optionalBooleanQuery,
  optionalEnumQuery,
  optionalIdQuery,
  optionalInstantQuery,
  optionalTextQuery,
  pageRows,
  parseListQuery,
  positiveId,
} from "../platform/operational-query-contract.js";

const ORDER_STATES = [
  "RECIBIDO", "EN_DIAGNOSTICO", "ESPERANDO_AUTORIZACION", "EN_REPARACION",
  "LISTO_PARA_ENTREGA", "PENDIENTE_ENTREGA_SIN_REPARACION", "ENTREGADO",
  "ENTREGADO_SIN_REPARACION", "CANCELADO",
];
const VIEWS = ["RECEPCION", "TECNICA", "INVENTARIO"];

function asyncRoute(handler) {
  return (request, response, next) => { Promise.resolve(handler(request, response, next)).catch(next); };
}

function meta(request) {
  return { requestId: request.requestId, generadoEn: new Date().toISOString() };
}

function hasAnyRole(auth, roles) {
  return roles.some((role) => auth.roles.includes(role));
}

function requireRoles(auth, roles) {
  if (!hasAnyRole(auth, roles)) throw new IdentityError("ACCION_NO_PERMITIDA", "The current role cannot use this query");
}

function selectOrderView(auth, explicit) {
  if (explicit !== undefined) {
    const required = explicit === "RECEPCION" ? ["ADMINISTRADOR", "RECEPCIONISTA"]
      : explicit === "TECNICA" ? ["MECANICO"] : ["INVENTARIO"];
    requireRoles(auth, required);
    return explicit;
  }
  if (hasAnyRole(auth, ["ADMINISTRADOR", "RECEPCIONISTA"])) return "RECEPCION";
  if (auth.roles.includes("MECANICO")) return "TECNICA";
  if (auth.roles.includes("INVENTARIO")) return "INVENTARIO";
  throw new IdentityError("ACCION_NO_PERMITIDA", "The current role cannot use this query");
}

function cursorPosition(cursorCodec, cursor, cursorContext) {
  return cursor === undefined ? undefined : cursorCodec.decode(cursor, cursorContext);
}

export function createOperationalQueryHttp({
  requireAuthenticated, customerVehicleQueries, orderQueries, cursorCodec,
} = {}) {
  if (typeof requireAuthenticated !== "function" || !customerVehicleQueries || !orderQueries || !cursorCodec) {
    throw new TypeError("Operational query HTTP dependencies are invalid");
  }
  const router = express.Router();

  router.get("/interno/clientes", requireAuthenticated, asyncRoute(async (request, response) => {
    requireRoles(request.auth, ["ADMINISTRADOR", "RECEPCIONISTA"]);
    const list = parseListQuery(request.query, ["q", "activo"]);
    const filters = { q: optionalTextQuery(request.query, "q") ?? null, activo: optionalBooleanQuery(request.query, "activo") ?? null };
    const cursorContext = { audience: { operation: "C01", actorId: request.auth.userId }, filters, order: "creadoEn:desc,id:desc" };
    const rows = await customerVehicleQueries.listCustomers({
      actorId: request.auth.userId, sessionId: request.auth.sessionId, q: filters.q ?? undefined,
      active: filters.activo ?? undefined, limit: list.limit,
      after: cursorPosition(cursorCodec, list.cursor, cursorContext),
    });
    response.status(200).json({ ...pageRows({ rows, limit: list.limit, cursorCodec, cursorContext }), meta: meta(request) });
  }));

  router.get("/interno/vehiculos", requireAuthenticated, asyncRoute(async (request, response) => {
    requireRoles(request.auth, ["ADMINISTRADOR", "RECEPCIONISTA"]);
    const list = parseListQuery(request.query, ["q", "clienteId", "activo"]);
    const filters = {
      q: optionalTextQuery(request.query, "q") ?? null,
      clienteId: optionalIdQuery(request.query, "clienteId") ?? null,
      activo: optionalBooleanQuery(request.query, "activo") ?? null,
    };
    const cursorContext = { audience: { operation: "V01", actorId: request.auth.userId }, filters, order: "creadoEn:desc,id:desc" };
    const rows = await customerVehicleQueries.listVehicles({
      actorId: request.auth.userId, sessionId: request.auth.sessionId, q: filters.q ?? undefined,
      clientId: filters.clienteId ?? undefined, active: filters.activo ?? undefined,
      limit: list.limit, after: cursorPosition(cursorCodec, list.cursor, cursorContext),
    });
    response.status(200).json({ ...pageRows({ rows, limit: list.limit, cursorCodec, cursorContext }), meta: meta(request) });
  }));

  router.get("/interno/vehiculos/:id", requireAuthenticated, asyncRoute(async (request, response) => {
    requireRoles(request.auth, ["ADMINISTRADOR", "RECEPCIONISTA"]);
    if (Object.keys(request.query).length !== 0) throw new OperationalQueryError("SOLICITUD_INVALIDA", "Query parameters are not allowed");
    const data = await customerVehicleQueries.getVehicle({
      actorId: request.auth.userId, sessionId: request.auth.sessionId,
      vehicleId: positiveId(request.params.id),
    });
    if (data === null) throw new OperationalQueryError("RECURSO_NO_ENCONTRADO", "Vehicle was not found");
    response.status(200).json({ data, meta: meta(request) });
  }));

  router.get("/interno/ordenes", requireAuthenticated, asyncRoute(async (request, response) => {
    const list = parseListQuery(request.query, ["desde", "hasta", "estado", "proposito", "vehiculoId", "activas", "vista"]);
    const view = selectOrderView(request.auth, optionalEnumQuery(request.query, "vista", VIEWS));
    const filters = {
      desde: optionalInstantQuery(request.query, "desde") ?? null,
      hasta: optionalInstantQuery(request.query, "hasta") ?? null,
      estado: optionalEnumQuery(request.query, "estado", ORDER_STATES) ?? null,
      proposito: optionalEnumQuery(request.query, "proposito", ["COMERCIAL", "GARANTIA"]) ?? null,
      vehiculoId: optionalIdQuery(request.query, "vehiculoId") ?? null,
      activas: optionalBooleanQuery(request.query, "activas") ?? null,
      vista: view,
    };
    if (filters.desde !== null && filters.hasta !== null && new Date(filters.hasta) <= new Date(filters.desde)) {
      throw new OperationalQueryError("SOLICITUD_INVALIDA", "hasta must be after desde");
    }
    const cursorContext = { audience: { operation: "O01", actorId: request.auth.userId, view }, filters, order: "ingresadoEn:desc,id:desc" };
    const rows = await orderQueries.listOrders({
      actorId: request.auth.userId, sessionId: request.auth.sessionId, view,
      from: filters.desde ?? undefined, until: filters.hasta ?? undefined,
      state: filters.estado ?? undefined, purpose: filters.proposito ?? undefined,
      vehicleId: filters.vehiculoId ?? undefined, active: filters.activas ?? undefined,
      limit: list.limit, after: cursorPosition(cursorCodec, list.cursor, cursorContext),
    });
    response.status(200).json({ ...pageRows({ rows, limit: list.limit, cursorCodec, cursorContext }), meta: meta(request) });
  }));

  router.get("/interno/ordenes/:id", requireAuthenticated, asyncRoute(async (request, response) => {
    const unknown = Object.keys(request.query).filter((key) => key !== "vista");
    if (unknown.length > 0) throw new OperationalQueryError("SOLICITUD_INVALIDA", "Unknown query parameter");
    const view = selectOrderView(request.auth, optionalEnumQuery(request.query, "vista", VIEWS));
    const data = await orderQueries.getOrder({
      actorId: request.auth.userId, sessionId: request.auth.sessionId,
      orderId: positiveId(request.params.id), view,
    });
    if (data === null) throw new OperationalQueryError("RECURSO_NO_ENCONTRADO", "Order was not found or is outside the permitted scope");
    response.status(200).json({ data, meta: meta(request) });
  }));

  return Object.freeze({ router });
}
