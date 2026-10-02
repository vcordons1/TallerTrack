import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const FORMAT = "ttur1";
const FORMAT_VERSION = 1;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const OBJECT_KEY = /^[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MIME_TYPE = /^[-a-z0-9!#$&^_.+]+\/[a-z0-9!#$&^_.+-]+$/;
const POSITIVE_ID = /^[1-9][0-9]{0,17}$/;
const INTENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTEXT_FIELDS = Object.freeze({
  RECEPCION_PREVIA: ["vehiculoId", "propiedadEsperadaId", "propietarioEsperadoId"],
  CONSENTIMIENTO: ["ordenId", "presupuestoId", "hashContenido"],
  DETENCION: ["ordenId"],
  RECEPCION: ["ordenId"],
  ENTREGA: ["ordenId"],
  DIAGNOSTICO: ["ordenId", "trabajoDiagnosticoId"],
  TRABAJO: ["ordenId", "trabajoId"],
  AMPLIACION: ["ordenId", "presupuestoId"],
  GARANTIA: ["ordenId", "reclamoId"],
});

export const DEFAULT_UPLOAD_RECEIPT_MAX_LENGTH = 4096;

export class UploadReceiptError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "UploadReceiptError";
    this.code = code;
  }
}

function reject(code = "INVALID_UPLOAD_RECEIPT") {
  throw new UploadReceiptError(code, "The upload receipt is invalid");
}

function hasExactKeys(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function normalizeId(value) {
  const normalized = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== "string" || !POSITIVE_ID.test(normalized)) reject();
  return normalized;
}

function normalizeContext(context) {
  if (context === null || typeof context !== "object" || Array.isArray(context)) reject();
  const fields = CONTEXT_FIELDS[context.tipo];
  if (fields === undefined || !hasExactKeys(context, ["tipo", ...fields])) reject();

  const normalized = { tipo: context.tipo };
  for (const field of fields) {
    if (field === "hashContenido") {
      if (typeof context[field] !== "string" || !SHA256.test(context[field])) reject();
      normalized[field] = context[field];
    } else {
      normalized[field] = normalizeId(context[field]);
    }
  }
  return Object.freeze(normalized);
}

function normalizeObjectMetadata(metadata) {
  if (!hasExactKeys(metadata, ["objectKey", "mimeType", "sizeBytes", "sha256"])) reject();
  const sizeBytes = typeof metadata.sizeBytes === "number" && Number.isSafeInteger(metadata.sizeBytes)
    ? String(metadata.sizeBytes)
    : metadata.sizeBytes;
  if (typeof metadata.objectKey !== "string" || !OBJECT_KEY.test(metadata.objectKey)
    || typeof metadata.mimeType !== "string" || metadata.mimeType.length > 100 || !MIME_TYPE.test(metadata.mimeType)
    || typeof sizeBytes !== "string" || !/^[1-9][0-9]{0,13}$/.test(sizeBytes)
    || typeof metadata.sha256 !== "string" || !SHA256.test(metadata.sha256)) {
    reject();
  }
  return Object.freeze({
    objectKey: metadata.objectKey,
    mimeType: metadata.mimeType,
    sizeBytes,
    sha256: metadata.sha256,
  });
}

function nowMilliseconds(now) {
  const value = now();
  const milliseconds = value instanceof Date ? value.getTime() : value;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new TypeError("Upload receipt clock returned an invalid instant");
  }
  return milliseconds;
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || value === "" || !BASE64URL.test(value)) reject();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) reject();
  return decoded;
}

function normalizedPayload(value) {
  if (!hasExactKeys(value, [
    "version", "intentId", "objectKey", "mimeType", "sizeBytes", "sha256",
    "issuedAt", "expiresAt", "actorId", "context",
  ]) || value.version !== FORMAT_VERSION
    || typeof value.intentId !== "string" || !INTENT_ID.test(value.intentId)
    || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)
    || value.issuedAt < 0 || value.expiresAt <= value.issuedAt) {
    reject();
  }
  const object = normalizeObjectMetadata({
    objectKey: value.objectKey,
    mimeType: value.mimeType,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
  });
  return Object.freeze({
    version: FORMAT_VERSION,
    intentId: value.intentId,
    ...object,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    actorId: normalizeId(value.actorId),
    context: normalizeContext(value.context),
  });
}

function sameContext(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createUploadReceiptSigner({
  hmacKey,
  ttlSeconds,
  maxTokenLength = DEFAULT_UPLOAD_RECEIPT_MAX_LENGTH,
  now = () => Date.now(),
  generateIntentId = randomUUID,
} = {}) {
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length < 32 || hmacKey.length > 128
    || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86_400
    || !Number.isSafeInteger(maxTokenLength) || maxTokenLength < 512 || maxTokenLength > 16_384
    || typeof now !== "function" || typeof generateIntentId !== "function") {
    throw new TypeError("Upload receipt configuration is invalid");
  }
  const signingKey = Buffer.from(hmacKey);

  function signature(message) {
    return createHmac("sha256", signingKey).update(message).digest();
  }

  function issue({ actorId, context, object } = {}) {
    const issuedAt = nowMilliseconds(now);
    const payload = normalizedPayload({
      version: FORMAT_VERSION,
      intentId: generateIntentId(),
      ...normalizeObjectMetadata(object),
      issuedAt,
      expiresAt: issuedAt + ttlSeconds * 1000,
      actorId: normalizeId(actorId),
      context: normalizeContext(context),
    });
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signedContent = `${FORMAT}.${encodedPayload}`;
    const receipt = `${signedContent}.${signature(signedContent).toString("base64url")}`;
    if (receipt.length > maxTokenLength) throw new TypeError("Upload receipt payload exceeds its safety limit");
    return Object.freeze({ receipt, payload });
  }

  function verify(receipt, { expectedActorId, expectedContext } = {}) {
    if (typeof receipt !== "string" || receipt.length < 1 || receipt.length > maxTokenLength) reject();
    const parts = receipt.split(".");
    if (parts.length !== 3 || parts[0] !== FORMAT) reject();

    const suppliedSignature = decodeBase64Url(parts[2]);
    const expectedSignature = signature(`${parts[0]}.${parts[1]}`);
    if (suppliedSignature.length !== expectedSignature.length
      || !timingSafeEqual(suppliedSignature, expectedSignature)) {
      reject();
    }

    let untrustedPayload;
    try {
      untrustedPayload = JSON.parse(decodeBase64Url(parts[1]).toString("utf8"));
    } catch (error) {
      if (error instanceof UploadReceiptError) throw error;
      reject();
    }
    const payload = normalizedPayload(untrustedPayload);
    const expectedActor = normalizeId(expectedActorId);
    const expectedNormalizedContext = normalizeContext(expectedContext);
    if (payload.actorId !== expectedActor || !sameContext(payload.context, expectedNormalizedContext)) {
      reject("UPLOAD_RECEIPT_CONTEXT_MISMATCH");
    }
    if (nowMilliseconds(now) >= payload.expiresAt) {
      // Signature, actor and context are already proven. The payload travels with the
      // rejection only so a K command can resolve an intention it already confirmed;
      // an expired receipt never authorizes consuming its object again.
      const expired = new UploadReceiptError("UPLOAD_RECEIPT_EXPIRED", "The upload receipt is invalid");
      Object.defineProperty(expired, "authenticatedPayload", { value: payload, enumerable: false });
      throw expired;
    }
    return payload;
  }

  return Object.freeze({ issue, verify });
}
