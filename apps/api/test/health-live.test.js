import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createApp } from "../src/app.js";

let server;
let baseUrl;

before(async () => {
  server = createApp({ checkReadiness: async () => false }).listen(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

test("GET /health/live reports that the HTTP process is alive", async () => {
  const response = await fetch(`${baseUrl}/health/live`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.has("x-powered-by"), false);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("GET /health/live stays live when Oracle readiness is false", async () => {
  const response = await fetch(`${baseUrl}/health/live`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("GET /health/ready returns a safe 503 when Oracle is not ready", async () => {
  const response = await fetch(`${baseUrl}/health/ready`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "not_ready" });
});

test("GET /health/ready hides Oracle error details and secrets", async () => {
  const secret = "Never-return-this-password";
  const unavailableServer = createApp({
    checkReadiness: async () => { throw new Error(`ORA-01017 ${secret}`); },
  }).listen(0);
  await new Promise((resolve) => unavailableServer.once("listening", resolve));

  try {
    const address = unavailableServer.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    const body = await response.text();
    assert.equal(response.status, 503);
    assert.equal(body, '{"status":"not_ready"}');
    assert.equal(body.includes("ORA-01017"), false);
    assert.equal(body.includes(secret), false);
  } finally {
    await new Promise((resolve, reject) => unavailableServer.close((error) => error ? reject(error) : resolve()));
  }
});
