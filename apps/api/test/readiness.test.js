import assert from "node:assert/strict";
import test from "node:test";

import { createReadinessCheck } from "../src/platform/readiness.js";

const config = {
  user: "TT_APP", schema: "TT_OWNER", expectedDatabase: "XE", expectedService: "XEPDB1",
};

function checkFor(rowOrError) {
  const poolManager = {
    withConnection: async (operation) => operation({ execute: async () => {
      if (rowOrError instanceof Error) throw rowOrError;
      return { rows: [rowOrError] };
    } }),
  };
  return createReadinessCheck({ poolManager, config });
}

test("readiness requires the runtime identity, service, four migrations, configuration, and all roles", async () => {
  assert.equal(await checkFor(["TT_APP", "XE", "XEPDB1", 4, 1, 5])(), true);
  for (const row of [
    ["TT_OWNER", "XE", "XEPDB1", 4, 1, 5],
    ["TT_APP", "OTHERDB", "XEPDB1", 4, 1, 5],
    ["TT_APP", "XE", "OTHERPDB", 4, 1, 5],
    ["TT_APP", "XE", "XEPDB1", 3, 1, 5],
    ["TT_APP", "XE", "XEPDB1", 4, 0, 5],
    ["TT_APP", "XE", "XEPDB1", 4, 1, 4],
  ]) assert.equal(await checkFor(row)(), false);
});

test("denied object access and Oracle failures do not become false READY", async () => {
  await assert.rejects(checkFor(new Error("ORA-00942"))(), /ORA-00942/);
});
