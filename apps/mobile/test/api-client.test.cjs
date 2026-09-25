const test = require("node:test");
const assert = require("node:assert/strict");

const { createApiClient } = require("../src/api/client.cjs");

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => "request-1" },
    json: async () => body };
}

test("simultaneous expired requests rotate refresh once and retry at most once", async () => {
  const calls = [];
  const writes = [];
  const store = { read: async () => ({ accessToken: "old", refreshToken: "refresh-old" }),
    write: async (value) => writes.push(value), clear: async () => {} };
  const client = createApiClient({ baseUrl: "http://laptop:3000/api/v1", store,
    fetchImpl: async (url, options) => {
      calls.push([url, options.headers.Authorization]);
      if (url.endsWith("/renovar")) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return response(200, { data: { accessToken: "new", refreshToken: "refresh-new" } });
      }
      if (options.headers.Authorization === "Bearer old") return response(401,
        { error: { code: "ACCESO_EXPIRADO", message: "expired" } });
      return response(200, { data: { success: true } });
    },
  });
  await client.restore();
  const result = await Promise.all([client.request("/a"), client.request("/b")]);
  assert.equal(result.every((item) => item.data.success), true);
  assert.equal(calls.filter(([url]) => url.endsWith("/renovar")).length, 1);
  assert.deepEqual(writes, [{ accessToken: "new", refreshToken: "refresh-new" }]);
  assert.equal(calls.filter(([url]) => url.endsWith("/a")).length, 2);
  assert.equal(calls.filter(([url]) => url.endsWith("/b")).length, 2);
});

test("failed refresh clears both tokens and rejects protected work", async () => {
  let cleared = 0;
  const client = createApiClient({ baseUrl: "http://laptop:3000/api/v1",
    store: { read: async () => ({ accessToken: "old", refreshToken: "secret" }),
      write: async () => {}, clear: async () => { cleared += 1; } },
    fetchImpl: async (url) => url.endsWith("/renovar")
      ? response(401, { error: { code: "RENOVACION_INVALIDA" } })
      : response(401, { error: { code: "ACCESO_EXPIRADO" } }),
  });
  await client.restore();
  await assert.rejects(() => client.request("/interno/ordenes"));
  assert.equal(cleared, 1);
  assert.equal(client.hasTokens, false);
});

test("logout deletes local credentials before the network request", async () => {
  let cleared = false;
  const client = createApiClient({ baseUrl: "http://laptop:3000/api/v1",
    store: { read: async () => ({ accessToken: "old", refreshToken: "secret" }),
      write: async () => {}, clear: async () => { cleared = true; } },
    fetchImpl: async () => { assert.equal(cleared, true); throw new Error("offline"); },
  });
  await client.restore();
  await client.logout();
  assert.equal(client.hasTokens, false);
});
