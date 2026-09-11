import assert from "node:assert/strict";
import test from "node:test";

import { loadOracleConfig, loadPrivateFileConfig } from "../src/platform/config.js";

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
    },
    { maxFileBytes: 10_485_760, maxPixels: 25_000_000, maxDimension: 8192, maxFilesPerOperation: 10 },
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
