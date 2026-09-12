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
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  if (request.path.startsWith("/api/v1/")) response.setHeader("Cache-Control", "no-store");
  next();
}

const CONFLICTS = new Set([
  "CLAVE_REUTILIZADA", "ORDEN_ACTIVA_EXISTENTE", "PROPIEDAD_CAMBIADA", "OBJETO_YA_CONSUMIDO",
]);
const DOMAIN_FAILURES = new Set([
  "DEUDA_NO_VERIFICABLE", "CLIENTE_NO_DISPONIBLE", "VEHICULO_NO_ENCONTRADO",
  "VEHICULO_NO_DISPONIBLE", "EVIDENCIA_REQUERIDA", "EVIDENCIA_NO_APLICABLE", "EVIDENCIA_INVALIDA",
]);
const RECEIPT_FAILURES = new Set([
  "INVALID_UPLOAD_RECEIPT", "UPLOAD_RECEIPT_CONTEXT_MISMATCH", "UPLOAD_RECEIPT_EXPIRED",
  "PREPARED_OBJECT_NOT_FOUND", "PREPARED_OBJECT_READ_FAILED", "PREPARED_OBJECT_METADATA_MISMATCH",
  "PREPARED_OBJECT_NOT_PUBLISHED",
]);
const STORAGE_FAILURES = new Set([
  "INVALID_STORAGE_CONFIGURATION", "PUBLIC_STORAGE_ROOT", "STORAGE_UNAVAILABLE",
  "STORAGE_WRITE_FAILED", "STORAGE_READ_FAILED",
]);

export function apiErrorHandler(error, request, response, _next, logger = console) {
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
  } else if (error?.code === "LIMITE_SOLICITUD_EXCEDIDO" || error?.code === "FILE_TOO_LARGE") {
    status = 413;
    code = "LIMITE_SOLICITUD_EXCEDIDO";
    message = "La solicitud excede el límite permitido.";
    recovery = "CORREGIR";
  } else if (error?.code === "IMAGE_VALIDATION_FAILED") {
    status = 415;
    code = "FORMATO_NO_ADMITIDO";
    message = "La fotografía no tiene un formato JPEG o PNG válido.";
    recovery = "CORREGIR";
  } else if (CONFLICTS.has(error?.code)) {
    status = 409;
    code = error.code;
    message = "La operación entra en conflicto con el estado actual.";
    recovery = error.code === "CLAVE_REUTILIZADA" ? "CORREGIR" : "RECARGAR";
  } else if (DOMAIN_FAILURES.has(error?.code) || RECEIPT_FAILURES.has(error?.code)
    || error?.code === "EVIDENCE_REQUIRED") {
    status = 422;
    code = error.code === "EVIDENCE_REQUIRED" ? "EVIDENCIA_REQUERIDA"
      : error.code === "EVIDENCIA_INVALIDA" ? "EVIDENCIA_NO_APLICABLE"
      : RECEIPT_FAILURES.has(error.code) ? "EVIDENCIA_NO_APLICABLE" : error.code;
    message = "La operación no cumple las condiciones vigentes.";
    recovery = "CORREGIR";
  } else if (error?.code === "ACTOR_O_SESION_INVALIDO") {
    status = 401;
    code = "SESION_INVALIDA";
    message = "No fue posible validar el acceso.";
    recovery = "REAUTENTICAR";
  } else if (error?.code === "ROL_RECEPCIONISTA_REQUERIDO") {
    status = 403;
    code = "ACCION_NO_PERMITIDA";
    message = "La acción no está permitida.";
    recovery = "CORREGIR";
  } else if (error?.code === "INVALID_ORDER_OPENING" || error?.code === "RECEPCION_INVALIDA"
    || error?.code === "SOLICITUD_INVALIDA" || error?.code === "SOLICITUD_ABORTADA") {
    status = 400;
    code = "SOLICITUD_INVALIDA";
    message = "La solicitud no es válida.";
    recovery = "CORREGIR";
  } else if (error?.code === "CLAVE_REQUERIDA") {
    status = 400;
    code = "CLAVE_REQUERIDA";
    message = "La clave de idempotencia es obligatoria.";
    recovery = "CORREGIR";
  } else if (STORAGE_FAILURES.has(error?.code)) {
    status = 503;
    code = "SERVICIO_NO_DISPONIBLE";
    message = "El almacenamiento privado no está disponible.";
    recovery = "ESPERAR";
  } else if (error?.code === "RESULTADO_NO_CONFIRMADO") {
    status = 503;
    code = "RESULTADO_INCIERTO";
    message = "No fue posible confirmar el resultado de la operación.";
    recovery = "REINTENTAR_MISMA_CLAVE";
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
  if (status >= 500) {
    logger?.error?.({
      requestId: body.requestId,
      method: request.method,
      path: request.path,
      category: code,
    });
  }
  response.status(status).json({ error: body });
}
