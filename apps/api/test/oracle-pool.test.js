import assert from "node:assert/strict";
import test from "node:test";

import { createOraclePoolManager } from "../src/platform/oracle-pool.js";

function fixture() {
  const calls = { createPool: 0, getConnection: 0, connectionClose: 0, poolClose: 0 };
  const connection = { close: async () => { calls.connectionClose += 1; } };
  const pool = {
    getConnection: async () => { calls.getConnection += 1; return connection; },
    close: async (drainTime) => { assert.equal(drainTime, 10); calls.poolClose += 1; },
  };
  const driver = { createPool: async () => { calls.createPool += 1; return pool; } };
  return { calls, connection, driver };
}

test("one concurrent initialization creates one pool and requests reuse it", async () => {
  const { calls, driver } = fixture();
  const manager = createOraclePoolManager({ driver, config: {} });
  await Promise.all([manager.initialize(), manager.initialize(), manager.initialize()]);
  await manager.withConnection(async () => "first");
  await manager.withConnection(async () => "second");
  assert.deepEqual(calls, { createPool: 1, getConnection: 2, connectionClose: 2, poolClose: 0 });
});

test("connections are released when an Oracle operation fails", async () => {
  const { calls, driver } = fixture();
  const manager = createOraclePoolManager({ driver, config: {} });
  await manager.initialize();
  await assert.rejects(manager.withConnection(async () => { throw new Error("query failed"); }), /query failed/);
  assert.equal(calls.connectionClose, 1);
});

test("repeated shutdown closes the pool exactly once", async () => {
  const { calls, driver } = fixture();
  const manager = createOraclePoolManager({ driver, config: {} });
  await manager.initialize();
  await Promise.all([manager.close(), manager.close()]);
  await manager.close();
  assert.equal(calls.poolClose, 1);
  await assert.rejects(manager.getConnection(), /not been initialized/);
  await assert.rejects(manager.initialize(), /closing or closed/);
});
