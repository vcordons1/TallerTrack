import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import oracledb from "oracledb";

import { startServer } from "../src/server.js";

const enabled = process.env.TT_RUN_ORACLE_INTEGRATION === "1";

async function environmentWithPrivateStorage(t, environment) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tallertrack-api-oracle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    ...environment,
    TT_PRIVATE_STORAGE_ROOT: root,
    TT_EVIDENCE_MAX_FILE_BYTES: "10485760",
    TT_EVIDENCE_MAX_PIXELS: "25000000",
    TT_EVIDENCE_MAX_DIMENSION: "8192",
    TT_EVIDENCE_MAX_FILES_PER_OPERATION: "10",
    TT_UPLOAD_RECEIPT_HMAC_KEY_BASE64: Buffer.alloc(32, 0x41).toString("base64"),
    TT_UPLOAD_RECEIPT_TTL_SECONDS: "900",
    TT_AUTH_SIGNING_KEY_BASE64: Buffer.alloc(32, 0x42).toString("base64"),
    TT_AUTH_ISSUER: "tallertrack-oracle-test",
    TT_AUTH_AUDIENCE: "tallertrack-api-test",
  };
}

test("Express reaches the migrated schema through one real Thin-mode pool", { skip: !enabled }, async (t) => {
  let poolCreations = 0;
  const driver = {
    createPool: (...arguments_) => {
      poolCreations += 1;
      return oracledb.createPool(...arguments_);
    },
  };
  const runtime = await startServer({
    environment: await environmentWithPrivateStorage(t, process.env),
    driver,
    logger: { log() {}, error() {} },
    port: 0,
  });
  const baseUrl = `http://127.0.0.1:${runtime.server.address().port}`;

  try {
    assert.equal(oracledb.thin, true);
    for (let request = 0; request < 3; request += 1) {
      const response = await fetch(`${baseUrl}/health/ready`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ready" });
    }
    assert.equal(poolCreations, 1);

    const evidence = await runtime.poolManager.withConnection((connection) => connection.execute(
      "select sys_context('USERENV','CURRENT_USER'), sys_context('USERENV','SERVICE_NAME') from dual",
    ));
    assert.deepEqual(
      [evidence.rows[0][0], evidence.rows[0][1].toUpperCase()],
      [process.env.TT_ORACLE_USER, "XEPDB1"],
    );
  } finally {
    await runtime.shutdown("TEST");
  }
});

test("a real incorrect credential returns safe NOT READY while liveness remains 200", { skip: !enabled }, async (t) => {
  const wrongPassword = `${process.env.TT_ORACLE_PASSWORD}x`;
  const runtime = await startServer({
    environment: await environmentWithPrivateStorage(t, { ...process.env, TT_ORACLE_PASSWORD: wrongPassword }),
    logger: { log() {}, error() {} },
    port: 0,
  });
  const baseUrl = `http://127.0.0.1:${runtime.server.address().port}`;

  try {
    const live = await fetch(`${baseUrl}/health/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: "ok" });
    const ready = await fetch(`${baseUrl}/health/ready`);
    const body = await ready.text();
    assert.equal(ready.status, 503);
    assert.equal(body, '{"status":"not_ready"}');
    assert.equal(body.includes(process.env.TT_ORACLE_PASSWORD), false);
    assert.equal(body.includes(wrongPassword), false);
  } finally {
    await runtime.shutdown("TEST");
  }
});
