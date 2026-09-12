import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import Busboy from "busboy";
import express from "express";

import { createLoginRateLimit } from "../identity/login-rate-limit.js";
import { IdentityError, requireAnyRole } from "../identity/identity-service.js";
import { parseStrictJsonObject } from "../../platform/strict-json.js";

const ID = /^[1-9][0-9]{0,17}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class ReceptionHttpError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "ReceptionHttpError";
    this.code = code;
  }
}

function reject(code, message, cause) {
  throw new ReceptionHttpError(code, message, cause === undefined ? undefined : { cause });
}

function asyncRoute(handler) {
  return (request, response, next) => { Promise.resolve(handler(request, response, next)).catch(next); };
}

function exactProperties(value, required) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === required.length
    && required.every((key) => Object.hasOwn(value, key));
}

function positiveId(value, field) {
  if (typeof value !== "string" || !ID.test(value)) reject("SOLICITUD_INVALIDA", `${field} is invalid`);
  return value;
}

function receptionContext(source) {
  let value;
  try {
    value = parseStrictJsonObject(source);
  } catch (error) {
    reject("SOLICITUD_INVALIDA", "The upload context is invalid", error);
  }
  const fields = ["tipo", "vehiculoId", "propiedadEsperadaId", "propietarioEsperadoId"];
  if (!exactProperties(value, fields) || value.tipo !== "RECEPCION_PREVIA") {
    reject("EVIDENCIA_NO_APLICABLE", "The upload context is not applicable to reception");
  }
  return Object.freeze({
    tipo: value.tipo,
    vehiculoId: positiveId(value.vehiculoId, "vehiculoId"),
    propiedadEsperadaId: positiveId(value.propiedadEsperadaId, "propiedadEsperadaId"),
    propietarioEsperadoId: positiveId(value.propietarioEsperadoId, "propietarioEsperadoId"),
  });
}

function correlationId(request) {
  const supplied = request.get("X-Correlation-ID");
  if (supplied === undefined) return randomUUID();
  if (!UUID.test(supplied)) reject("SOLICITUD_INVALIDA", "X-Correlation-ID is invalid");
  return supplied;
}

function idempotencyKey(request) {
  const supplied = request.get("Idempotency-Key");
  if (supplied === undefined) reject("CLAVE_REQUERIDA", "Idempotency-Key is required");
  if (!UUID.test(supplied)) reject("SOLICITUD_INVALIDA", "Idempotency-Key is invalid");
  return supplied;
}

function parseReceptionBody(source) {
  let body;
  try {
    body = parseStrictJsonObject(source);
  } catch (error) {
    reject("SOLICITUD_INVALIDA", "The JSON request is invalid", error);
  }
  const fields = [
    "vehiculoId", "propiedadEsperadaId", "propietarioEsperadoId", "kilometrajeIngreso",
    "motivoIngreso", "danosVisibles", "evidenciasRecepcion",
  ];
  if (!exactProperties(body, fields)) reject("SOLICITUD_INVALIDA", "The request has missing or unknown fields");
  if (!Array.isArray(body.evidenciasRecepcion)) reject("SOLICITUD_INVALIDA", "evidenciasRecepcion is invalid");
  if (body.evidenciasRecepcion.some((item) => !exactProperties(item, ["recibo", "descripcion"]))) {
    reject("SOLICITUD_INVALIDA", "A reception evidence item has missing or unknown fields");
  }
  return body;
}

function commandMeta(request, result) {
  return Object.freeze({
    requestId: request.requestId,
    generadoEn: new Date().toISOString(),
    comandoId: String(result.commandId),
    confirmadoEn: result.confirmedAt,
    repetido: result.repeated,
  });
}

function createDeferred() {
  let resolve;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    rejectPromise = rejectValue;
  });
  promise.catch(() => {});
  return { promise, resolve, reject: rejectPromise };
}

async function parseUpload(request, { preparedUpload, limits }) {
  let parser;
  try {
    parser = Busboy({
      headers: request.headers,
      limits: {
        files: 1,
        fileSize: limits.maxFileBytes,
        fields: limits.multipartMaxFields,
        fieldSize: limits.multipartMaxFieldBytes,
        // Individual file/field limits enforce the exact shape. One extra part
        // lets Busboy observe and report the first forbidden part.
        parts: 2 + limits.multipartMaxFields,
      },
    });
  } catch (error) {
    reject("SOLICITUD_INVALIDA", "A valid multipart/form-data request is required", error);
  }

  const deferredContext = createDeferred();
  let contextCount = 0;
  let fileCount = 0;
  let parsingFailure;
  let preparedPromise;

  const fail = (code, message, cause) => {
    parsingFailure ??= new ReceptionHttpError(code, message, cause === undefined ? undefined : { cause });
  };

  parser.on("field", (name, value, info) => {
    contextCount += 1;
    if (name !== "contexto" || info.valueTruncated || contextCount !== 1) {
      fail("SOLICITUD_INVALIDA", "The multipart fields are invalid");
      return;
    }
    try {
      deferredContext.resolve(receptionContext(value));
    } catch (error) {
      parsingFailure ??= error;
      deferredContext.reject(error);
    }
  });

  parser.on("file", (name, file, info) => {
    fileCount += 1;
    if (name !== "archivo" || fileCount !== 1) {
      fail("SOLICITUD_INVALIDA", "Exactly one archivo part is required");
      file.resume();
      return;
    }
    let exceeded = false;
    file.once("limit", () => { exceeded = true; });
    const source = Readable.from((async function* boundedFile() {
      for await (const chunk of file) yield chunk;
      if (exceeded || file.truncated) {
        throw new ReceptionHttpError(
          "LIMITE_SOLICITUD_EXCEDIDO", "The uploaded file exceeds the configured limit",
        );
      }
    })());
    preparedPromise = preparedUpload.prepare({
      source,
      declaredMimeType: info.mimeType,
      actorId: request.auth.userId,
      context: deferredContext.promise,
    });
    preparedPromise.catch(() => {});
  });
  parser.once("filesLimit", () => fail("SOLICITUD_INVALIDA", "Exactly one archivo part is required"));
  parser.once("fieldsLimit", () => fail("SOLICITUD_INVALIDA", "Too many multipart fields"));
  parser.once("partsLimit", () => fail("SOLICITUD_INVALIDA", "Too many multipart parts"));

  const aborted = () => parser.destroy(new ReceptionHttpError("SOLICITUD_ABORTADA", "The upload was interrupted"));
  request.once("aborted", aborted);
  let prepared;
  try {
    await pipeline(request, parser);
    if (contextCount !== 1 || fileCount !== 1 || preparedPromise === undefined) {
      fail("SOLICITUD_INVALIDA", "The multipart request requires contexto and one archivo");
    }
    if (contextCount !== 1) deferredContext.reject(parsingFailure ?? new ReceptionHttpError(
      "SOLICITUD_INVALIDA", "The multipart context is required",
    ));
    if (parsingFailure !== undefined) throw parsingFailure;
    prepared = await preparedPromise;
    return prepared;
  } catch (error) {
    deferredContext.reject(error);
    if (preparedPromise !== undefined) {
      try { prepared = await preparedPromise; } catch { /* The storage adapter removed its temporary. */ }
    }
    if (prepared !== undefined) await preparedUpload.discardPrepared(prepared).catch(() => {});
    throw error;
  } finally {
    request.off("aborted", aborted);
  }
}

export function createReceptionHttp({
  identityService,
  requireAuthenticated,
  preparedUpload,
  openCommercialOrder,
  privateFileConfig,
} = {}) {
  if (!identityService || typeof requireAuthenticated !== "function"
    || !preparedUpload || typeof preparedUpload.prepare !== "function"
    || typeof preparedUpload.discardPrepared !== "function"
    || typeof openCommercialOrder !== "function" || !privateFileConfig) {
    throw new TypeError("Reception HTTP dependencies are invalid");
  }
  const router = express.Router();
  const requireReceptionist = requireAnyRole("RECEPCIONISTA");
  const uploadRateLimit = createLoginRateLimit({
    maximumAttempts: privateFileConfig.uploadMaximumRequests,
    windowSeconds: privateFileConfig.uploadWindowSeconds,
    capacity: privateFileConfig.uploadBucketCapacity,
  });
  const limitUpload = (request, _response, next) => {
    const allowance = uploadRateLimit.consume(request.ip, `actor:${request.auth.userId}`);
    if (!allowance.allowed) {
      const error = new IdentityError("DEMASIADAS_SOLICITUDES", "Too many upload attempts");
      error.retryAfterSeconds = allowance.retryAfterSeconds;
      next(error);
      return;
    }
    next();
  };

  router.post("/interno/evidencias/cargar", requireAuthenticated, requireReceptionist, limitUpload,
    asyncRoute(async (request, response) => {
      const prepared = await parseUpload(request, { preparedUpload, limits: privateFileConfig });
      response.status(201).json({
        data: {
          recibo: prepared.receipt,
          expiraEn: prepared.expiresAt,
          tipoContenido: prepared.mimeType,
          tamanoBytes: String(prepared.sizeBytes),
          sha256: prepared.sha256,
        },
        meta: { requestId: request.requestId, generadoEn: new Date().toISOString() },
      });
    }));

  router.post("/interno/ordenes/abrir", requireAuthenticated, requireReceptionist,
    (request, response, next) => {
      if (!request.is("application/json")) {
        next(new ReceptionHttpError("SOLICITUD_INVALIDA", "Content-Type application/json is required"));
        return;
      }
      express.text({ type: "application/json", limit: "32kb" })(request, response, next);
    },
    asyncRoute(async (request, response) => {
      const body = parseReceptionBody(request.body);
      const result = await openCommercialOrder({
        actorId: request.auth.userId,
        sessionId: request.auth.sessionId,
        idempotencyKey: idempotencyKey(request),
        correlationId: correlationId(request),
        vehicleId: body.vehiculoId,
        expectedPropertyId: body.propiedadEsperadaId,
        expectedOwnerId: body.propietarioEsperadoId,
        mileageEntry: body.kilometrajeIngreso,
        entryReason: body.motivoIngreso,
        visibleDamage: body.danosVisibles,
        receptionEvidence: body.evidenciasRecepcion.map((item) => ({
          receipt: item?.recibo,
          description: item?.descripcion,
        })),
      });
      const data = {
        ordenId: String(result.orderId),
        version: String(result.version),
        estado: result.state,
        clienteContractualId: String(result.contractualClientId),
        propiedadAperturaId: String(result.openingPropertyId),
        citaId: null,
        evidenciasIds: result.evidenceIds.map(String),
        excepcionConsumidaId: null,
      };
      response.location(`/api/v1/interno/ordenes/${data.ordenId}`).status(201)
        .json({ data, meta: commandMeta(request, result) });
    }));

  return Object.freeze({ router });
}
