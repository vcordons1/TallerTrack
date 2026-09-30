import assert from "node:assert/strict";
import test from "node:test";

import {
  loadAuthConfig,
  loadBindHost,
  loadOracleConfig,
  loadPrivateFileConfig,
  loadUploadReceiptConfig,
} from "../src/platform/config.js";

test("Express binds to loopback unless the LAN demo explicitly opts in", () => {
  assert.equal(loadBindHost({}), "127.0.0.1");
  assert.equal(loadBindHost({ TT_API_BIND_HOST: "0.0.0.0" }), "0.0.0.0");
  assert.throws(() => loadBindHost({ TT_API_BIND_HOST: "192.168.1.10" }), /TT_API_BIND_HOST/);
});

test("authentication profile requires secrets and coherent bounded TTLs", () => {
  const environment = {
    TT_AUTH_SIGNING_KEY_BASE64: Buffer.alloc(32, 0x41).toString("base64"),
    TT_AUTH_ISSUER: "tallertrack-local",
    TT_AUTH_AUDIENCE: "tallertrack-api",
  };
  assert.deepEqual(loadAuthConfig(environment), {
    signingKey: Buffer.alloc(32, 0x41), issuer: "tallertrack-local", audience: "tallertrack-api",
    algorithm: "HS256", accessTtlSeconds: 600, sessionTtlSeconds: 43_200,
    refreshTtlSeconds: 43_200, loginMaximumAttempts: 5, loginWindowSeconds: 900,
    loginBucketCapacity: 5000, hashMaximumConcurrency: 4,
  });
  assert.throws(() => loadAuthConfig({ ...environment, TT_AUTH_ACCESS_TTL_SECONDS: "43200" }),
    /TT_AUTH_ACCESS_TTL_SECONDS|access < refresh/);
  assert.throws(() => loadAuthConfig({ ...environment, TT_AUTH_REFRESH_TTL_SECONDS: "50000" }),
    /refresh <= session/);
  assert.throws(() => loadAuthConfig({ ...environment, TT_AUTH_SIGNING_KEY_BASE64: "c2hvcnQ=" }),
    /32 and 128 bytes/);
});

const validEnvironment = {
  TT_ORACLE_USER: "TT_APP",
  TT_ORACLE_PASSWORD: "Secret-value-not-for-output",
  TT_ORACLE_CONNECT_STRING: "127.0.0.1:1521/XEPDB1",
  TT_ORACLE_SCHEMA: "TT_OWNER",
  TT_ORACLE_EXPECTED_DATABASE: "XE",
  TT_ORACLE_EXPECTED_SERVICE: "XEPDB1",
};

test("Oracle configuration has bounded pool defaults", () => {
  assert.deepEqual(loadOracleConfig(validEnvironment), {
    user: "TT_APP", password: validEnvironment.TT_ORACLE_PASSWORD,
    connectString: "127.0.0.1:1521/XEPDB1", schema: "TT_OWNER",
    expectedDatabase: "XE", expectedService: "XEPDB1",
    poolMin: 0, poolMax: 4, poolIncrement: 1, queueTimeout: 5000, poolTimeout: 60,
  });
});

test("missing and invalid configuration fails without exposing secrets", () => {
  for (const environment of [
    { ...validEnvironment, TT_ORACLE_PASSWORD: undefined },
    { ...validEnvironment, TT_ORACLE_POOL_MIN: "5", TT_ORACLE_POOL_MAX: "4" },
    { ...validEnvironment, TT_ORACLE_SCHEMA: "TT_OWNER; DROP USER TT_APP" },
  ]) {
    assert.throws(() => loadOracleConfig(environment), (error) => {
      assert.equal(error.message.includes(validEnvironment.TT_ORACLE_PASSWORD), false);
      return true;
    });
  }
});

const validPrivateFileEnvironment = {
  TT_PRIVATE_STORAGE_ROOT: ".data/private-files",
  TT_EVIDENCE_MAX_FILE_BYTES: "10485760",
  TT_EVIDENCE_MAX_PIXELS: "25000000",
  TT_EVIDENCE_MAX_DIMENSION: "8192",
  TT_EVIDENCE_MAX_FILES_PER_OPERATION: "10",
};

test("private file limits are explicit, bounded environment configuration", () => {
  const config = loadPrivateFileConfig(validPrivateFileEnvironment);
  assert.equal(config.rootDirectory.endsWith(".data\\private-files") || config.rootDirectory.endsWith(".data/private-files"), true);
  assert.deepEqual(
    {
      maxFileBytes: config.maxFileBytes,
      maxPixels: config.maxPixels,
      maxDimension: config.maxDimension,
      maxFilesPerOperation: config.maxFilesPerOperation,
      multipartMaxFields: config.multipartMaxFields,
      multipartMaxFieldBytes: config.multipartMaxFieldBytes,
      uploadMaximumRequests: config.uploadMaximumRequests,
      uploadWindowSeconds: config.uploadWindowSeconds,
      uploadBucketCapacity: config.uploadBucketCapacity,
    },
    {
      maxFileBytes: 10_485_760, maxPixels: 25_000_000, maxDimension: 8192,
      maxFilesPerOperation: 10, multipartMaxFields: 1, multipartMaxFieldBytes: 4096,
      uploadMaximumRequests: 20, uploadWindowSeconds: 60, uploadBucketCapacity: 5000,
    },
  );
  assert.equal(config.prohibitedPublicDirectories.length, 2);
});

test("missing or invalid private file configuration fails safely", () => {
  for (const environment of [
    { ...validPrivateFileEnvironment, TT_PRIVATE_STORAGE_ROOT: undefined },
    { ...validPrivateFileEnvironment, TT_EVIDENCE_MAX_FILE_BYTES: undefined },
    { ...validPrivateFileEnvironment, TT_EVIDENCE_MAX_PIXELS: "0" },
    { ...validPrivateFileEnvironment, TT_EVIDENCE_MAX_DIMENSION: "not-a-number" },
    { ...validPrivateFileEnvironment, TT_EVIDENCE_MAX_FILES_PER_OPERATION: "101" },
  ]) {
    assert.throws(() => loadPrivateFileConfig(environment));
  }
});

const receiptSecret = Buffer.alloc(32, 0x5a).toString("base64");

test("upload receipt signing key and TTL are required and bounded", () => {
  const config = loadUploadReceiptConfig({
    TT_UPLOAD_RECEIPT_HMAC_KEY_BASE64: receiptSecret,
    TT_UPLOAD_RECEIPT_TTL_SECONDS: "900",
  });
  assert.deepEqual(config, { hmacKey: Buffer.alloc(32, 0x5a), ttlSeconds: 900 });

  for (const environment of [
    { TT_UPLOAD_RECEIPT_TTL_SECONDS: "900" },
    { TT_UPLOAD_RECEIPT_HMAC_KEY_BASE64: "not-base64", TT_UPLOAD_RECEIPT_TTL_SECONDS: "900" },
    { TT_UPLOAD_RECEIPT_HMAC_KEY_BASE64: Buffer.alloc(31).toString("base64"), TT_UPLOAD_RECEIPT_TTL_SECONDS: "900" },
    { TT_UPLOAD_RECEIPT_HMAC_KEY_BASE64: receiptSecret },
    { TT_UPLOAD_RECEIPT_HMAC_KEY_BASE64: receiptSecret, TT_UPLOAD_RECEIPT_TTL_SECONDS: "0" },
  ]) {
    assert.throws(() => loadUploadReceiptConfig(environment), (error) => {
      assert.equal(error.message.includes(receiptSecret), false);
      return true;
    });
  }
});
