const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("react");
const Module = require("node:module");
// Render with the exact React instance of this workspace (see users.test.cjs).
const rendererPath = require.resolve("react-test-renderer/cjs/react-test-renderer.development.js");
const rendererModule = new Module(rendererPath, module);
rendererModule.filename = rendererPath;
rendererModule.require = (name) => name === "react" ? React : Module.createRequire(rendererPath)(name);
rendererModule._compile(fs.readFileSync(rendererPath, "utf8"), rendererPath);
const { act, create } = rendererModule.exports;
const babel = require("@babel/core");

const { orderListQuery } = require("../src/features/orders/orderListQuery.cjs");
const { createApiClient } = require("../src/api/client.cjs");
global.IS_REACT_ACT_ENVIRONMENT = true;

const RECEPTION = path.join(__dirname, "../src/features/reception");

function harness({ request, params = {} }) {
  const moves = [];
  let uuid = 0;
  const mocks = {
    "expo-router": { router: { push: (url) => moves.push(url), replace: (url) => moves.push(url) },
      useLocalSearchParams: () => params },
    "expo-crypto": { randomUUID: () => `ui-key-${++uuid}` },
    "expo-image-picker": {
      requestCameraPermissionsAsync: async () => ({ granted: true }),
      launchCameraAsync: async () => ({ canceled: false, assets: [{ uri: "file:///camera.jpg", mimeType: "image/jpeg" }] }),
      launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: "file:///gallery.png", mimeType: "image/png" }] }),
    },
    "expo-file-system": { File: class { constructor(uri) { this.uri = uri; this.type = uri.endsWith(".png") ? "image/png" : "image/jpeg"; } } },
    "react-native": { ActivityIndicator: "ActivityIndicator", Image: "Image", Pressable: "Pressable", Text: "Text",
      TextInput: "TextInput", View: "View", KeyboardAvoidingView: "KeyboardAvoidingView", Platform: { OS: "android" },
      StyleSheet: { create: (s) => s } },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = babel.transformSync(fs.readFileSync(file, "utf8"), { babelrc: false, configFile: false, filename: file,
      plugins: [["@babel/plugin-transform-react-jsx", { runtime: "automatic" }], "@babel/plugin-transform-modules-commonjs"] }).code;
    const localRequire = (name) => {
      if (mocks[name]) return mocks[name];
      if (name.endsWith("api/runtime")) return { api: { request } };
      if (name.endsWith("components/ScreenContainer")) return { ScreenContainer: "ScreenContainer" };
      if (name.endsWith("theme/tokens")) return { colors: {}, radii: {}, spacing: {}, typography: {} };
      if (name.startsWith(".")) {
        const resolved = path.resolve(path.dirname(file), name);
        if (resolved.endsWith(".cjs")) return require(resolved);
        if (resolved.startsWith(RECEPTION) && fs.existsSync(`${resolved}.js`)) return load(`${resolved}.js`);
        return require(resolved);
      }
      return require(name);
    };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`,
      { console, URLSearchParams, setTimeout, clearTimeout, Promise, FormData, Date })(localRequire, module, module.exports);
    return module.exports;
  }
  return { screen: load(path.join(RECEPTION, "ReceptionScreen.js")), moves };
}

const content = (tree) => JSON.stringify(tree.toJSON());
const plain = (value) => JSON.parse(JSON.stringify(value));
const pressable = (tree, text) => tree.root.findAllByType("Pressable").find((node) =>
  node.findAllByType("Text").some((t) => t.children.join("") === text));
const input = (tree, label) => tree.root.findAllByType("TextInput").find((n) => n.props.accessibilityLabel === label);
async function mount(Component) { let tree; await act(async () => { tree = create(React.createElement(Component)); }); return tree; }

const vehicle = { id: "21", placa: "P-TT026", marca: "Toyota", modelo: "Yaris", activo: true, ordenActivaId: null,
  propiedadActual: { id: "31", clienteId: "21", nombreCliente: "Cliente TT026" } };
const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

function server({ open }) {
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith("/interno/vehiculos/")) return { data: vehicle };
    if (url === "/interno/evidencias/cargar") {
      return { data: { recibo: "receipt-1", expiraEn: expiresAt, tipoContenido: "image/jpeg", tamanoBytes: "10", sha256: "a".repeat(64) } };
    }
    if (url === "/interno/ordenes/abrir") return open(options);
    if (url.startsWith("/interno/ordenes/")) return { data: { id: "77" } };
    throw new Error(`unexpected ${url}`);
  };
  return { calls, request };
}

async function fillAndPrepare(tree) {
  await act(async () => {
    input(tree, "Kilometraje de ingreso").props.onChangeText("1234");
    input(tree, "Motivo de ingreso").props.onChangeText("Revisión de frenos");
  });
  await act(async () => pressable(tree, "Declarar: Sin daños visibles").props.onPress());
  await act(async () => pressable(tree, "Tomar fotografía").props.onPress());
  await act(async () => pressable(tree, "Preparar evidencia").props.onPress());
}

test("from a vehicle: server owner, explicit no-damage, E01 preparation, then O02 confirmation and detail", async () => {
  const backend = server({ open: async () => ({ data: { ordenId: "77", estado: "RECIBIDO" } }) });
  const h = harness({ request: backend.request, params: { vehiculoId: "21" } });
  const tree = await mount(h.screen.ReceptionScreen);
  assert.ok(content(tree).includes("Cliente TT026"));
  assert.ok(content(tree).includes("P-TT026"));
  await fillAndPrepare(tree);
  const text = content(tree);
  assert.ok(text.includes("Evidencia preparada"));
  assert.ok(text.includes("todavía no existe ninguna orden"));
  assert.equal(backend.calls.some(({ url }) => url === "/interno/ordenes/abrir"), false, "preparing never opens an order");
  const upload = backend.calls.find(({ url }) => url === "/interno/evidencias/cargar");
  assert.equal(upload.options.method, "POST");
  await act(async () => pressable(tree, "Confirmar recepción").props.onPress());
  const open = backend.calls.find(({ url }) => url === "/interno/ordenes/abrir");
  assert.deepEqual(plain(open.options.body), { vehiculoId: "21", propiedadEsperadaId: "31", propietarioEsperadoId: "21",
    kilometrajeIngreso: "1234", motivoIngreso: "Revisión de frenos", danosVisibles: "Sin daños visibles",
    evidenciasRecepcion: [{ recibo: "receipt-1", descripcion: "Fotografía de recepción" }] });
  assert.equal(open.options.headers["Idempotency-Key"], "ui-key-1");
  assert.deepEqual(plain(h.moves.at(-1)), { pathname: "/interno/ordenes/[id]", params: { id: "77" } });
  await act(async () => tree.unmount());
});

test("unknown O02 result keeps the intention: same key and body, no new opening offered", async () => {
  let attempts = 0;
  const backend = server({ open: async () => {
    if (++attempts === 1) throw Object.assign(new Error("lost"), { uncertain: true, status: 0 });
    return { data: { ordenId: "77" } };
  } });
  const h = harness({ request: backend.request, params: { vehiculoId: "21" } });
  const tree = await mount(h.screen.ReceptionScreen);
  await fillAndPrepare(tree);
  await act(async () => pressable(tree, "Confirmar recepción").props.onPress());
  const text = content(tree);
  assert.ok(text.includes("Resultado desconocido"));
  assert.equal(text.includes("Falló"), false);
  assert.equal(pressable(tree, "Confirmar recepción"), undefined);
  assert.equal(input(tree, "Motivo de ingreso").props.editable, false);
  await act(async () => pressable(tree, "Verificar esta misma recepción").props.onPress());
  const opens = backend.calls.filter(({ url }) => url === "/interno/ordenes/abrir");
  assert.equal(opens.length, 2);
  assert.equal(opens[0].options.headers["Idempotency-Key"], opens[1].options.headers["Idempotency-Key"]);
  assert.deepEqual(plain(opens[0].options.body), plain(opens[1].options.body));
  assert.deepEqual(plain(h.moves.at(-1)), { pathname: "/interno/ordenes/[id]", params: { id: "77" } });
  await act(async () => tree.unmount());
});

test("an active order conflict shows the existing order instead of a confirmation", async () => {
  const backend = server({ open: async () => {
    throw Object.assign(new Error("active"), { status: 409, code: "ORDEN_ACTIVA_EXISTENTE", uncertain: false, details: { ordenId: "55" } });
  } });
  const h = harness({ request: backend.request, params: { vehiculoId: "21" } });
  const tree = await mount(h.screen.ReceptionScreen);
  await fillAndPrepare(tree);
  await act(async () => pressable(tree, "Confirmar recepción").props.onPress());
  assert.ok(content(tree).includes("Este vehículo ya tiene una atención activa."));
  await act(async () => pressable(tree, "Ver orden activa #55").props.onPress());
  assert.deepEqual(plain(h.moves.at(-1)), { pathname: "/interno/ordenes/[id]", params: { id: "55" } });
  await act(async () => tree.unmount());
});

test("O01 filters are sent to the server, never applied only to loaded pages", () => {
  const read = (query) => Object.fromEntries(new URLSearchParams(query));
  assert.deepEqual(read(orderListQuery("RECEPCION", null, { filter: "TODAS" })), { vista: "RECEPCION", limite: "25" });
  assert.deepEqual(read(orderListQuery("RECEPCION", null, { filter: "ACTIVAS" })), { vista: "RECEPCION", limite: "25", activas: "true" });
  assert.deepEqual(read(orderListQuery("RECEPCION", "c1", { filter: "ESPERANDO_AUTORIZACION" })),
    { vista: "RECEPCION", limite: "25", estado: "ESPERANDO_AUTORIZACION", cursor: "c1" });
  assert.deepEqual(read(orderListQuery("TECNICA", null, { filter: "LISTAS_PARA_ENTREGA", vehicleId: "21" })),
    { vista: "TECNICA", limite: "25", activas: "true", vehiculoId: "21" });
});

test("the API client exposes only the server's closed error details", async () => {
  const client = createApiClient({ baseUrl: "http://laptop:3000/api/v1",
    store: { read: async () => ({ accessToken: "a", refreshToken: "r" }), write: async () => {}, clear: async () => {} },
    fetchImpl: async () => ({ ok: false, status: 409, headers: { get: () => null },
      json: async () => ({ error: { code: "ORDEN_ACTIVA_EXISTENTE", resultado: "NO_CONFIRMADO", details: { ordenId: "55" }, fields: [] } }) }),
  });
  await client.restore();
  await assert.rejects(client.request("/interno/ordenes/abrir", { method: "POST", body: {}, uncertainBusinessResult: true }),
    (error) => error.code === "ORDEN_ACTIVA_EXISTENTE" && error.details.ordenId === "55" && error.uncertain === false);
});
