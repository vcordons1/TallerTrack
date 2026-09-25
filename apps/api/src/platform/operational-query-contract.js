import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ID = /^[1-9][0-9]{0,17}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export class OperationalQueryError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "OperationalQueryError";
    this.code = code;
  }
}

function invalid(message) {
  throw new OperationalQueryError("SOLICITUD_INVALIDA", message);
}

export function positiveId(value, field = "id") {
  if (typeof value !== "string" || !ID.test(value)) invalid(`${field} is invalid`);
  return value;
}

function one(query, name) {
  const value = query[name];
  if (Array.isArray(value)) invalid(`${name} cannot be repeated`);
  return value;
}

export function parseListQuery(query, allowedFilters) {
  const allowed = new Set(["cursor", "limite", ...allowedFilters]);
  for (const key of Object.keys(query)) if (!allowed.has(key)) invalid(`Unknown query parameter ${key}`);

  const rawLimit = one(query, "limite");
  if (rawLimit !== undefined && !/^[1-9][0-9]*$/.test(rawLimit)) invalid("limite is invalid");
  const limit = rawLimit === undefined ? 25 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit > 100) invalid("limite is invalid");

  const cursor = one(query, "cursor");
  if (cursor !== undefined && (typeof cursor !== "string" || cursor.length < 10 || cursor.length > 4096)) {
    throw new OperationalQueryError("CURSOR_INVALIDO", "cursor is invalid");
  }
  return { cursor, limit };
}

export function optionalTextQuery(query, name) {
  const value = one(query, name);
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalid(`${name} is invalid`);
  const trimmed = value.trim();
  if (trimmed.length < 2 || [...trimmed].length > 100) invalid(`${name} is invalid`);
  return trimmed;
}

export function optionalBooleanQuery(query, name) {
  const value = one(query, name);
  if (value === undefined) return undefined;
  if (value !== "true" && value !== "false") invalid(`${name} is invalid`);
  return value === "true";
}

export function optionalIdQuery(query, name) {
  const value = one(query, name);
  return value === undefined ? undefined : positiveId(value, name);
}

export function optionalEnumQuery(query, name, values) {
  const value = one(query, name);
  if (value === undefined) return undefined;
  if (!values.includes(value)) invalid(`${name} is invalid`);
  return value;
}

export function optionalInstantQuery(query, name) {
  const value = one(query, name);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !INSTANT.test(value)) invalid(`${name} is invalid`);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
    || hour > 23 || minute > 59 || second > 59) invalid(`${name} is invalid`);
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  if (offset !== null && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) invalid(`${name} is invalid`);
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) invalid(`${name} is invalid`);
  const fraction = /\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? "";
  const microseconds = fraction.padEnd(6, "0");
  return date.toISOString().replace(/\.\d{3}Z$/, `.${microseconds}Z`);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createOpaqueCursorCodec({ hmacKey }) {
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length < 32) throw new TypeError("Cursor HMAC key is invalid");
  const key = createHash("sha256").update("tallertrack:list-cursor:v1\0").update(hmacKey).digest();
  const additionalData = Buffer.from("tallertrack:list-cursor:v1");

  return Object.freeze({
    encode({ audience, filters, order, position }) {
      const payload = Buffer.from(canonical({ v: 1, audience, filters, order, position }));
      const initializationVector = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
      cipher.setAAD(additionalData);
      const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
      return `v1.${initializationVector.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
    },
    decode(cursor, expected) {
      try {
        const match = /^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{22})$/.exec(cursor);
        if (match === null) throw new Error("shape");
        const initializationVector = Buffer.from(match[1], "base64url");
        const encrypted = Buffer.from(match[2], "base64url");
        const tag = Buffer.from(match[3], "base64url");
        const decipher = createDecipheriv("aes-256-gcm", key, initializationVector);
        decipher.setAAD(additionalData);
        decipher.setAuthTag(tag);
        const payload = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        const decoded = JSON.parse(payload.toString("utf8"));
        if (decoded.v !== 1 || canonical(decoded.audience) !== canonical(expected.audience)
          || canonical(decoded.filters) !== canonical(expected.filters)
          || decoded.order !== expected.order || !decoded.position
          || typeof decoded.position.date !== "string" || !ID.test(decoded.position.id)) throw new Error("binding");
        return Object.freeze(decoded.position);
      } catch (error) {
        throw new OperationalQueryError("CURSOR_INVALIDO", "cursor is invalid", { cause: error });
      }
    },
  });
}

export function pageRows({ rows, limit, cursorCodec, cursorContext }) {
  const hayMas = rows.length > limit;
  const selected = hayMas ? rows.slice(0, limit) : rows;
  const last = selected.at(-1);
  return Object.freeze({
    data: Object.freeze(selected.map(({ _position, ...row }) => Object.freeze(row))),
    page: Object.freeze({
      siguienteCursor: hayMas ? cursorCodec.encode({ ...cursorContext, position: last._position }) : null,
      hayMas,
    }),
  });
}
