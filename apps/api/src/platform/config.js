import path from "node:path";
import { fileURLToPath } from "node:url";

const ORACLE_IDENTIFIER = /^[A-Z][A-Z0-9_$#]{0,29}$/;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function requireValue(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Required environment variable ${name} is missing or empty`);
  }
  return value;
}

function readInteger(environment, name, defaultValue, { minimum, maximum }) {
  const rawValue = environment[name];
  if (rawValue === undefined) {
    return defaultValue;
  }
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function readRequiredInteger(environment, name, bounds) {
  requireValue(environment, name);
  return readInteger(environment, name, undefined, bounds);
}

function readIdentifier(environment, name) {
  const value = requireValue(environment, name).toUpperCase();
  if (!ORACLE_IDENTIFIER.test(value)) {
    throw new Error(`${name} must be a simple Oracle identifier`);
  }
  return value;
}

function readBase64Secret(environment, name) {
  const encoded = requireValue(environment, name);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error(`${name} must contain canonical base64`);
  }
  const value = Buffer.from(encoded, "base64");
  if (value.toString("base64") !== encoded || value.length < 32 || value.length > 128) {
    throw new Error(`${name} must decode to between 32 and 128 bytes`);
  }
  return value;
}

export function loadOracleConfig(environment = process.env) {
  const poolMin = readInteger(environment, "TT_ORACLE_POOL_MIN", 0, { minimum: 0, maximum: 100 });
  const poolMax = readInteger(environment, "TT_ORACLE_POOL_MAX", 4, { minimum: 1, maximum: 100 });
  const poolIncrement = readInteger(environment, "TT_ORACLE_POOL_INCREMENT", 1, { minimum: 1, maximum: 100 });

  if (poolMin > poolMax) {
    throw new Error("TT_ORACLE_POOL_MIN cannot exceed TT_ORACLE_POOL_MAX");
  }
  if (poolIncrement > poolMax) {
    throw new Error("TT_ORACLE_POOL_INCREMENT cannot exceed TT_ORACLE_POOL_MAX");
  }

  return Object.freeze({
    user: readIdentifier(environment, "TT_ORACLE_USER"),
    password: requireValue(environment, "TT_ORACLE_PASSWORD"),
    connectString: requireValue(environment, "TT_ORACLE_CONNECT_STRING"),
    schema: readIdentifier(environment, "TT_ORACLE_SCHEMA"),
    expectedDatabase: requireValue(environment, "TT_ORACLE_EXPECTED_DATABASE").toUpperCase(),
    expectedService: requireValue(environment, "TT_ORACLE_EXPECTED_SERVICE").toUpperCase(),
    poolMin,
    poolMax,
    poolIncrement,
    queueTimeout: readInteger(environment, "TT_ORACLE_QUEUE_TIMEOUT_MS", 5000, { minimum: 1, maximum: 120000 }),
    poolTimeout: readInteger(environment, "TT_ORACLE_POOL_TIMEOUT_SECONDS", 60, { minimum: 1, maximum: 3600 }),
  });
}

export function loadPort(environment = process.env) {
  return readInteger(environment, "PORT", 3000, { minimum: 1, maximum: 65535 });
}

export function loadPrivateFileConfig(environment = process.env) {
  const configuredRoot = requireValue(environment, "TT_PRIVATE_STORAGE_ROOT");

  return Object.freeze({
    rootDirectory: path.resolve(configuredRoot),
    maxFileBytes: readRequiredInteger(environment, "TT_EVIDENCE_MAX_FILE_BYTES", {
      minimum: 1,
      maximum: 100 * 1024 * 1024,
    }),
    maxPixels: readRequiredInteger(environment, "TT_EVIDENCE_MAX_PIXELS", {
      minimum: 1,
      maximum: 100_000_000,
    }),
    maxDimension: readRequiredInteger(environment, "TT_EVIDENCE_MAX_DIMENSION", {
      minimum: 1,
      maximum: 50_000,
    }),
    maxFilesPerOperation: readRequiredInteger(environment, "TT_EVIDENCE_MAX_FILES_PER_OPERATION", {
      minimum: 1,
      maximum: 100,
    }),
    prohibitedPublicDirectories: Object.freeze([
      path.join(REPOSITORY_ROOT, "apps", "api", "public"),
      path.join(REPOSITORY_ROOT, "apps", "mobile", "public"),
    ]),
  });
}

export function loadUploadReceiptConfig(environment = process.env) {
  return Object.freeze({
    hmacKey: readBase64Secret(environment, "TT_UPLOAD_RECEIPT_HMAC_KEY_BASE64"),
    ttlSeconds: readRequiredInteger(environment, "TT_UPLOAD_RECEIPT_TTL_SECONDS", {
      minimum: 1,
      maximum: 86_400,
    }),
  });
}

export function loadAuthConfig(environment = process.env) {
  const accessTtlSeconds = readInteger(environment, "TT_AUTH_ACCESS_TTL_SECONDS", 600, {
    minimum: 60,
    maximum: 3600,
  });
  const sessionTtlSeconds = readInteger(environment, "TT_AUTH_SESSION_TTL_SECONDS", 43_200, {
    minimum: 600,
    maximum: 604_800,
  });
  const refreshTtlSeconds = readInteger(environment, "TT_AUTH_REFRESH_TTL_SECONDS", 43_200, {
    minimum: 600,
    maximum: 604_800,
  });
  if (accessTtlSeconds >= refreshTtlSeconds || refreshTtlSeconds > sessionTtlSeconds) {
    throw new Error("Auth TTLs must satisfy access < refresh <= session");
  }

  return Object.freeze({
    signingKey: readBase64Secret(environment, "TT_AUTH_SIGNING_KEY_BASE64"),
    issuer: requireValue(environment, "TT_AUTH_ISSUER"),
    audience: requireValue(environment, "TT_AUTH_AUDIENCE"),
    algorithm: "HS256",
    accessTtlSeconds,
    sessionTtlSeconds,
    refreshTtlSeconds,
    loginMaximumAttempts: readInteger(environment, "TT_AUTH_LOGIN_MAX_ATTEMPTS", 5, {
      minimum: 1,
      maximum: 100,
    }),
    loginWindowSeconds: readInteger(environment, "TT_AUTH_LOGIN_WINDOW_SECONDS", 900, {
      minimum: 1,
      maximum: 86_400,
    }),
    loginBucketCapacity: readInteger(environment, "TT_AUTH_LOGIN_BUCKET_CAPACITY", 5000, {
      minimum: 100,
      maximum: 100_000,
    }),
    hashMaximumConcurrency: readInteger(environment, "TT_AUTH_HASH_MAX_CONCURRENCY", 4, {
      minimum: 1,
      maximum: 32,
    }),
  });
}
