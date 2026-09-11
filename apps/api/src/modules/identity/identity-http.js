import { randomUUID } from "node:crypto";

import express from "express";

import { IdentityError } from "./identity-service.js";
import { parseStrictJsonObject } from "../../platform/strict-json.js";

function exactProperties(value, required, optional = []) {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key));
}

function strictBody(request, required, optional) {
  let body;
  try {
    body = parseStrictJsonObject(request.body);
  } catch (error) {
    throw new IdentityError("SOLICITUD_INVALIDA", "The JSON request is invalid", { cause: error });
  }
  if (!exactProperties(body, required, optional)) {
    throw new IdentityError("SOLICITUD_INVALIDA", "The request has missing or unknown fields");
  }
  return body;
}

function bearerToken(request) {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === "authorization") count += 1;
  }
  const value = request.headers.authorization;
  if (count !== 1 || typeof value !== "string" || value.length > 4096) {
    throw new IdentityError("ACCESO_EXPIRADO", "Authorization header is invalid");
  }
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(value);
  if (match === null) throw new IdentityError("ACCESO_EXPIRADO", "Authorization header is invalid");
  return match[1];
}

function asyncRoute(handler) {
  return (request, response, next) => { Promise.resolve(handler(request, response, next)).catch(next); };
}

function meta(request) {
  return Object.freeze({ requestId: request.requestId, generadoEn: new Date().toISOString() });
}

export function createIdentityHttp({ identityService }) {
  const router = express.Router();
  router.use(express.text({ type: "application/json", limit: "16kb" }));

  const requireAuthenticated = createRequireAuthenticated({ identityService });

  router.post("/acceso/sesiones", asyncRoute(async (request, response) => {
    const body = strictBody(request, ["login", "password"], ["dispositivo"]);
    const data = await identityService.login(body, request.ip);
    response.location("/api/v1/acceso/yo").status(201).json({ data, meta: meta(request) });
  }));

  router.post("/acceso/sesiones/renovar", asyncRoute(async (request, response) => {
    const body = strictBody(request, ["refreshToken"], []);
    const data = await identityService.refresh(body, request.requestId);
    response.status(200).json({ data, meta: meta(request) });
  }));

  router.post("/acceso/sesiones/cerrar", requireAuthenticated, asyncRoute(async (request, response) => {
    strictBody(request, [], []);
    await identityService.logout(request.auth, request.requestId);
    response.status(204).end();
  }));

  router.get("/acceso/yo", requireAuthenticated, (request, response) => {
    if (Object.keys(request.query).length !== 0) {
      throw new IdentityError("SOLICITUD_INVALIDA", "Query parameters are not allowed");
    }
    response.status(200).json({ data: request.auth.acceso, meta: meta(request) });
  });

  return Object.freeze({ router, requireAuthenticated });
}

export function createRequireAuthenticated({ identityService }) {
  return asyncRoute(async (request, _response, next) => {
    request.auth = await identityService.authenticate(bearerToken(request));
    next();
  });
}

export function requestContext(request, response, next) {
  request.requestId = randomUUID();
  response.setHeader("X-Request-ID", request.requestId);
  if (request.path.startsWith("/api/v1/")) response.setHeader("Cache-Control", "no-store");
  next();
}

export function apiErrorHandler(error, request, response, _next) {
  let status = 500;
  let code = "ERROR_INTERNO";
  let message = "No se pudo completar la solicitud.";
  let recovery = "NINGUNA";
  if (error instanceof IdentityError) {
    code = error.code;
    if (code === "SOLICITUD_INVALIDA") status = 400;
    else if (code === "ACCION_NO_PERMITIDA") status = 403;
    else if (code === "DEMASIADAS_SOLICITUDES") status = 429;
    else status = 401;
    message = status === 429
      ? "Demasiados intentos. Espera antes de volver a intentar."
      : status === 403 ? "La acción no está permitida." : status === 400
        ? "La solicitud no es válida." : "No fue posible validar el acceso.";
    recovery = status === 401 ? "REAUTENTICAR" : status === 429 ? "ESPERAR" : "CORREGIR";
  } else if (error?.type === "entity.too.large") {
    status = 413;
    code = "LIMITE_SOLICITUD_EXCEDIDO";
    message = "La solicitud excede el límite permitido.";
    recovery = "CORREGIR";
  }
  if (status === 429 && Number.isSafeInteger(error.retryAfterSeconds)) {
    response.setHeader("Retry-After", String(error.retryAfterSeconds));
  }
  const body = {
    code,
    message,
    requestId: request.requestId ?? randomUUID(),
    recuperacion: recovery,
    fields: [],
    details: {},
  };
  if (request.method !== "GET") body.resultado = status >= 500 ? "DESCONOCIDO" : "NO_CONFIRMADO";
  response.status(status).json({ error: body });
}
