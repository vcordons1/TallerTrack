const test = require("node:test");
const assert = require("node:assert/strict");

const { createApiClient } = require("../src/api/client.cjs");

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => "request-1" },
    json: async () => body };
}

test("a lost K response preserves uncertainty for malformed success or unstructured 5xx", async () => {
  for (const reply of [response(201, null), response(503, null)]) {
    const client = createApiClient({ baseUrl: "http://laptop:3000/api/v1",
      store: { read: async () => ({ accessToken: "a", refreshToken: "r" }) }, fetchImpl: async () => reply });
    await client.restore();
    await assert.rejects(client.request("/interno/usuarios", { method: "POST", body: {}, uncertainBusinessResult: true }),
      (error) => error.uncertain === true);
  }
});

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

test("transport and server uncertainty are explicit for O02, never inferred from POST for E01", async () => {
  const store = { read: async () => ({ accessToken: "access", refreshToken: "refresh" }),
    write: async () => {}, clear: async () => {} };
  for (const failure of ["transport", "server"]) {
    const client = createApiClient({ baseUrl: "http://laptop:3000/api/v1", store,
      fetchImpl: async () => {
        if (failure === "transport") throw new TypeError("Network request failed");
        return response(503, { error: { code: "SERVICIO_NO_DISPONIBLE", resultado: "DESCONOCIDO" } });
      },
    });
    await client.restore();
    const upload = () => client.request("/interno/evidencias/cargar", { method: "POST", body: {} });
    await assert.rejects(upload, (error) => error.uncertain === false
      && (failure !== "transport" || error.transportCause === "Network request failed"));
    const open = () => client.request("/interno/ordenes/abrir", {
      method: "POST", body: {}, uncertainBusinessResult: true,
    });
    await assert.rejects(open, (error) => error.uncertain === true);
  }
});

test("O02 retry sends the identical JSON and Idempotency-Key after a lost response", async () => {
  const requests = [];
  const client = createApiClient({ baseUrl: "http://laptop:3000/api/v1",
    store: { read: async () => ({ accessToken: "access", refreshToken: "refresh" }),
      write: async () => {}, clear: async () => {} },
    fetchImpl: async (_url, options) => {
      requests.push(options);
      if (requests.length === 1) throw new TypeError("response lost");
      return response(201, { data: { ordenId: "10" } });
    },
  });
  await client.restore();
  const body = { vehiculoId: "7", evidenciasRecepcion: [{ recibo: "receipt" }] };
  const options = { method: "POST", body, headers: { "Idempotency-Key": "fixed-key" },
    uncertainBusinessResult: true };
  await assert.rejects(() => client.request("/interno/ordenes/abrir", options),
    (error) => error.uncertain === true);
  assert.equal((await client.request("/interno/ordenes/abrir", options)).data.ordenId, "10");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers["Idempotency-Key"], "fixed-key");
  assert.equal(requests[1].headers["Idempotency-Key"], "fixed-key");
  assert.equal(requests[0].body, requests[1].body);
});

test("React Native FormData is passed directly to fetch without a JSON Content-Type", async () => {
  const original = globalThis.FormData;
  class NativeFormData {}
  globalThis.FormData = NativeFormData;
  try {
    const form = new NativeFormData();
    let sent;
    const client = createApiClient({ baseUrl: "http://laptop:3000/api/v1",
      store: { read: async () => ({ accessToken: "access", refreshToken: "refresh" }),
        write: async () => {}, clear: async () => {} },
      fetchImpl: async (_url, options) => { sent = options; return response(201, { data: { recibo: "r" } }); },
    });
    await client.restore();
    await client.request("/interno/evidencias/cargar", { method: "POST", body: form });
    assert.strictEqual(sent.body, form);
    assert.equal(sent.headers["Content-Type"], undefined);
  } finally { globalThis.FormData = original; }
});
