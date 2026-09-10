import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createShutdown } from "../src/server.js";

test("shutdown stops HTTP and closes the Oracle pool exactly once", async () => {
  const server = http.createServer((_request, response) => response.end("ok"));
  await new Promise((resolve) => server.listen(0, resolve));
  let poolCloses = 0;
  const shutdown = createShutdown({
    server,
    poolManager: { close: async () => { poolCloses += 1; } },
    logger: { error() {} },
  });

  const first = shutdown("SIGTERM");
  const second = shutdown("SIGINT");
  assert.equal(first, second);
  await first;
  assert.equal(server.listening, false);
  assert.equal(poolCloses, 1);
});
