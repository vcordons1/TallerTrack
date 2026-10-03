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

const { createAssignmentFlow } = require("../src/features/orders/assignmentFlow.cjs");
const { assignmentMessage } = require("../src/features/orders/assignmentMessage.cjs");
const { CAPABILITIES, ROLES, getInternalDestinations, hasInternalCapability } = require("../src/navigation/accessPolicy");
global.IS_REACT_ACT_ENVIRONMENT = true;

const plain = (value) => JSON.parse(JSON.stringify(value));
const fail = (fields) => Object.assign(new Error("server"), fields);

// --- Navigation ----------------------------------------------------------------------------

test("Mis órdenes belongs to MECANICO only; R+M get the union without a role selector", () => {
  const keys = (roles) => getInternalDestinations(roles).map(({ key }) => key);
  assert.deepEqual(keys([ROLES.MECANICO]), ["home", "myOrders"]);
  assert.deepEqual(keys([ROLES.RECEPCIONISTA, ROLES.MECANICO]), ["home", "orders", "myOrders", "agenda", "management"]);
  assert.equal(keys([ROLES.ADMINISTRADOR]).includes("myOrders"), false);
  assert.equal(keys([ROLES.ADMINISTRADOR]).includes("orders"), false);
  assert.equal(keys([ROLES.INVENTARIO]).includes("myOrders"), false);
  assert.equal(hasInternalCapability([ROLES.RECEPCIONISTA], CAPABILITIES.TECHNICAL_ORDERS), false);
  assert.equal(hasInternalCapability([ROLES.ADMINISTRADOR, ROLES.MECANICO], CAPABILITIES.TECHNICAL_ORDERS), true);
});

// --- O06/O07 intention ---------------------------------------------------------------------

function backend(responses) {
  const calls = [];
  let n = 0;
  const request = async (url, options) => {
    calls.push({ url, key: options.headers["Idempotency-Key"], body: plain(options.body), uncertain: options.uncertainBusinessResult });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { data: next };
  };
  return { calls, flow: createAssignmentFlow({ request, uuid: () => `key-${++n}` }) };
}

test("O06 sends one frozen body with a key created before the first send", async () => {
  const { calls, flow } = backend([{ participacionId: "5", mecanicoId: "9" }]);
  assert.deepEqual(plain(await flow.assign("21", "9", "  Diagnóstico  ")), { participacionId: "5", mecanicoId: "9" });
  assert.deepEqual(calls, [{ url: "/interno/ordenes/21/asignar-mecanico", key: "key-1",
    body: { mecanicoId: "9", motivo: "Diagnóstico" }, uncertain: true }]);
  assert.equal(flow.phase, "CONFIRMADO");
  assert.equal(flow.locked, false);
});

test("unknown O06 result locks the intention; verifying resends the same key and body", async () => {
  const { calls, flow } = backend([fail({ uncertain: true, status: 503 }), { participacionId: "5", mecanicoId: "9" }]);
  await assert.rejects(flow.assign("21", "9", "Diagnóstico"));
  assert.equal(flow.phase, "DESCONOCIDO");
  assert.equal(flow.locked, true);
  assert.doesNotMatch(assignmentMessage(flow.error, flow.kind), /Falló/);
  assert.match(assignmentMessage(flow.error, flow.kind), /Resultado desconocido/);
  await assert.rejects(Promise.resolve().then(() => flow.retire("21", "3", "Otro")), /resultado pendiente/);
  assert.equal(flow.acknowledge(), false, "an unknown result cannot be dismissed");
  // New input is ignored while the intention is pending: the frozen body is resent.
  await flow.assign("21", "77", "Otro motivo");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(flow.phase, "CONFIRMADO");
  assert.equal(flow.locked, false);
});

test("a confirmed rejection ends the intention; the next intention uses a new key", async () => {
  const { calls, flow } = backend([fail({ status: 409, code: "REFERENCIA_DUPLICADA" }), { participacionId: "6", mecanicoId: "8" }]);
  await assert.rejects(flow.assign("21", "9", "Duplicado"));
  assert.equal(flow.phase, "RECHAZADO");
  assert.equal(flow.locked, false);
  assert.equal(assignmentMessage(flow.error, flow.kind), "Ese mecánico ya participa en esta orden.");
  await flow.assign("21", "8", "Otro");
  assert.deepEqual(calls.map(({ key }) => key), ["key-1", "key-2"]);
});

test("a replay refused for another session is not a failure: the list must be checked", async () => {
  const { flow } = backend([fail({ uncertain: true }), fail({ status: 409, code: "CLAVE_REUTILIZADA" })]);
  await assert.rejects(flow.assign("21", "9", "Diagnóstico"));
  await assert.rejects(flow.verify());
  assert.equal(flow.phase, "SIN_VERIFICAR");
  assert.equal(flow.locked, false);
  assert.match(assignmentMessage(flow.error, flow.kind), /Revisa la lista de participantes/);
});

test("O07 retire, local validation and double tap", async () => {
  let release;
  const calls = [];
  const flow = createAssignmentFlow({ uuid: () => "key-1", request: async (url, options) => {
    calls.push({ url, body: plain(options.body) });
    await new Promise((resolve) => { release = resolve; });
    return { data: { participacionId: "3", retiradoEn: "2026-10-02T00:00:00.000000Z" } };
  } });
  assert.throws(() => flow.retire("21", "3", "   "), /motivo/);
  assert.throws(() => flow.retire("21", "3", "x".repeat(501)), /motivo/);
  assert.throws(() => flow.assign("21", null, "Motivo"), /Selecciona/);
  const first = flow.retire("21", "3", "Cambio de turno");
  assert.equal(await flow.retire("21", "3", "Cambio de turno"), null, "double tap sends nothing");
  release();
  await first;
  assert.deepEqual(calls, [{ url: "/interno/ordenes/21/participaciones/3/retirar", body: { motivo: "Cambio de turno" } }]);
  assert.equal(assignmentMessage({ code: "ESTADO_INCOMPATIBLE" }, "RETIRAR").includes("ya estaba retirada"), true);
  assert.match(assignmentMessage({ code: "ROL_REQUERIDO" }, "ASIGNAR"), /ya no es un mecánico activo/);
});

// --- Rendered screens -----------------------------------------------------------------------

const FEATURE = path.join(__dirname, "../src/features/orders");

function harness({ request, roles, params = { id: "21" } }) {
  const moves = [];
  const session = { access: { tipoActor: "INTERNO", usuarioId: "1", roles } };
  const cache = new Map();
  let uuid = 0;
  const FlatList = ({ data, renderItem, ListEmptyComponent, ListHeaderComponent }) =>
    React.createElement("FlatList", null, ListHeaderComponent,
      data.length > 0 ? data.map((item) => React.createElement(React.Fragment, { key: item.id }, renderItem({ item })))
        : ListEmptyComponent);
  const mocks = {
    "expo-router": { router: { push: (url) => moves.push(url), replace: (url) => moves.push(url) },
      useFocusEffect: () => {}, useLocalSearchParams: () => params },
    "expo-crypto": { randomUUID: () => `ui-key-${++uuid}` },
    "@expo/vector-icons/MaterialCommunityIcons": "Icon",
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "react-native": { ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", TextInput: "TextInput",
      View: "View", FlatList, RefreshControl: "RefreshControl", StyleSheet: { create: (s) => s } },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = babel.transformSync(fs.readFileSync(file, "utf8"), { babelrc: false, configFile: false, filename: file,
      plugins: [["@babel/plugin-transform-react-jsx", { runtime: "automatic" }], "@babel/plugin-transform-modules-commonjs"] }).code;
    const localRequire = (name) => {
      if (mocks[name]) return mocks[name];
      if (name.endsWith("api/runtime")) return { api: { request } };
      if (name.endsWith("session/SessionProvider")) return { useSession: () => session };
      if (name.endsWith("components/ScreenContainer")) return { ScreenContainer: "ScreenContainer" };
      if (name.endsWith("components/ProductHeader")) return { ProductHeader: "ProductHeader" };
      if (name.endsWith("components/AccountHeaderAction")) return { AccountHeaderAction: "AccountHeaderAction" };
      if (name.endsWith("theme/tokens")) return { colors: {}, radii: {}, spacing: {}, typography: {} };
      if (name.startsWith(".")) {
        const resolved = path.resolve(path.dirname(file), name);
        if (resolved.endsWith(".cjs")) return require(resolved);
        if (resolved.startsWith(FEATURE) && fs.existsSync(`${resolved}.js`)) return load(`${resolved}.js`);
        return require(resolved);
      }
      return require(name);
    };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`,
      { console, URLSearchParams, setTimeout, clearTimeout, Promise, Date, Intl })(localRequire, module, module.exports);
    return module.exports;
  }
  return { detail: load(path.join(FEATURE, "RealOrderDetailScreen.js")), list: load(path.join(FEATURE, "OrderListScreen.js")),
    repository: load(path.join(FEATURE, "realOrderRepository.js")), moves };
}

const content = (tree) => JSON.stringify(tree.toJSON());
const pressable = (tree, text) => tree.root.findAllByType("Pressable").find((node) =>
  node.findAllByType("Text").some((t) => t.children.join("") === text));
const input = (tree, label) => tree.root.findAllByType("TextInput").find((n) => n.props.accessibilityLabel === label);
async function mount(element) { let tree; await act(async () => { tree = create(element); }); return tree; }
const press = (tree, text) => act(async () => pressable(tree, text).props.onPress());

const vehicle = { id: "21", placa: "P-TT026", marca: "Toyota", modelo: "Yaris", anio: 2020 };
const base = { id: "21", version: "1", vehiculo: vehicle, proposito: "COMERCIAL", estado: "RECIBIDO",
  ingresadoEn: "2026-10-02T15:00:00.000000Z", kilometrajeIngreso: "48250.0", motivoIngreso: "Ruido",
  danosVisibles: "Sin daños visibles", detencion: { solicitada: false }, conciliacion: {} };
const reception = { ...base, clienteContractual: { id: "21", nombre: "Cliente TT026" }, saldo: {} };
const current = { id: "7", mecanico: { id: "50", nombre: "Mecánico TT028" }, asignadoEn: "2026-10-02T16:00:00.000000Z",
  retiradoEn: null, motivoRetiro: null };
const retired = { id: "6", mecanico: { id: "51", nombre: "Mecánico Dos" }, asignadoEn: "2026-10-02T15:30:00.000000Z",
  retiradoEn: "2026-10-02T15:40:00.000000Z", motivoRetiro: "Cambio de turno" };

function server({ order = reception, participants = [current, retired], assign, retire, detailError } = {}) {
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith("/interno/mecanicos?")) return { data: [{ id: "50", nombre: "Mecánico TT028" }, { id: "52", nombre: "Mecánico Tres" }] };
    if (url.includes("/mecanicos?")) return { data: participants };
    if (url.endsWith("/asignar-mecanico")) return assign(options);
    if (url.endsWith("/retirar")) return retire(options);
    if (url.startsWith("/interno/ordenes/21?")) { if (detailError) throw detailError; return { data: order }; }
    if (url.startsWith("/interno/ordenes?")) return { data: [] };
    throw new Error(`unexpected ${url}`);
  };
  return { calls, request };
}

test("receptionist sees current and retired participants and assigns through I15 search with a reason", async () => {
  const backendCalls = server({ assign: async () => ({ data: { participacionId: "8", mecanicoId: "52" } }) });
  const h = harness({ request: backendCalls.request, roles: ["RECEPCIONISTA"] });
  const tree = await mount(React.createElement(h.detail.RealOrderDetailScreen));
  const text = content(tree);
  assert.ok(text.includes("Cliente TT026"));
  assert.ok(text.includes("Mecánico TT028") && text.includes("Vigente"));
  assert.ok(text.includes("Participaciones retiradas") && text.includes("Cambio de turno"));
  await press(tree, "Asignar mecánico");
  await act(async () => input(tree, "Buscar mecánico").props.onChangeText("tres"));
  await press(tree, "Buscar");
  assert.ok(backendCalls.calls.some(({ url }) => url === "/interno/mecanicos?ordenId=21&limite=50&q=tres"));
  // Already participating mechanics stay selectable: Oracle, not the UI, decides duplicates.
  assert.ok(pressable(tree, "Mecánico TT028 · ya participa"));
  await press(tree, "Mecánico Tres");
  assert.equal(pressable(tree, "Confirmar asignación").props.disabled, true, "a reason is required");
  await act(async () => input(tree, "Motivo de la asignación").props.onChangeText("Apoyo en diagnóstico"));
  await press(tree, "Confirmar asignación");
  const sent = backendCalls.calls.find(({ url }) => url.endsWith("/asignar-mecanico"));
  assert.deepEqual(plain(sent.options.body), { mecanicoId: "52", motivo: "Apoyo en diagnóstico" });
  assert.equal(sent.options.headers["Idempotency-Key"], "ui-key-1");
  assert.ok(content(tree).includes("Asignación confirmada en el servidor."));
  await act(async () => tree.unmount());
});

test("duplicate assignment shows the server rejection; unknown retirement locks the form and verifies the same intention", async () => {
  let retires = 0;
  const backendCalls = server({
    assign: async () => { throw fail({ status: 409, code: "REFERENCIA_DUPLICADA", uncertain: false }); },
    retire: async () => {
      if (++retires === 1) throw fail({ status: 0, uncertain: true });
      return { data: { participacionId: "7", retiradoEn: "2026-10-02T17:00:00.000000Z" } };
    },
  });
  const h = harness({ request: backendCalls.request, roles: ["RECEPCIONISTA"] });
  const tree = await mount(React.createElement(h.detail.RealOrderDetailScreen));
  await press(tree, "Asignar mecánico");
  await press(tree, "Mecánico TT028 · ya participa");
  await act(async () => input(tree, "Motivo de la asignación").props.onChangeText("Repetida"));
  await press(tree, "Confirmar asignación");
  assert.ok(content(tree).includes("Ese mecánico ya participa en esta orden."));
  await press(tree, "Cancelar");
  await press(tree, "Retirar a Mecánico TT028");
  await act(async () => input(tree, "Motivo del retiro").props.onChangeText("Fin de turno"));
  await press(tree, "Confirmar retiro");
  const text = content(tree);
  assert.ok(text.includes("Resultado desconocido"));
  assert.equal(text.includes("Falló"), false);
  assert.equal(input(tree, "Motivo del retiro").props.editable, false);
  assert.equal(pressable(tree, "Cancelar"), undefined);
  await press(tree, "Verificar este mismo retiro");
  const sent = backendCalls.calls.filter(({ url }) => url.endsWith("/retirar"));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].options.headers["Idempotency-Key"], sent[1].options.headers["Idempotency-Key"]);
  assert.deepEqual(plain(sent[0].options.body), plain(sent[1].options.body));
  assert.ok(content(tree).includes("Retiro confirmado en el servidor."));
  await act(async () => tree.unmount());
});

test("technical detail shows no commercial data and no coordination or diagnostic actions", async () => {
  const backendCalls = server({ order: base });
  const h = harness({ request: backendCalls.request, roles: ["MECANICO"] });
  const tree = await mount(React.createElement(h.detail.RealOrderDetailScreen,
    { view: "TECNICA", listRoute: "/interno/mis-ordenes", listLabel: "Mis órdenes" }));
  const text = content(tree);
  assert.ok(backendCalls.calls.some(({ url }) => url === "/interno/ordenes/21?vista=TECNICA"));
  assert.ok(text.includes("VISTA TÉCNICA"));
  assert.ok(text.includes("Mecánico TT028"));
  for (const hidden of ["Cliente contractual", "Asignar mecánico", "Retirar a", "Proponer diagnóstico", "Confirmar diagnóstico", "Saldo"]) {
    assert.equal(text.includes(hidden), false, hidden);
  }
  assert.equal(backendCalls.calls.some(({ url }) => url.includes("/trabajos") || url.includes("/diagnosticos")), false);
  await act(async () => tree.unmount());
});

test("a retired participation or revoked role blocks the technical detail and returns to Mis órdenes", async () => {
  const backendCalls = server({ order: base, detailError: fail({ status: 404, code: "RECURSO_NO_ENCONTRADO" }) });
  const h = harness({ request: backendCalls.request, roles: ["MECANICO"] });
  const tree = await mount(React.createElement(h.detail.RealOrderDetailScreen,
    { view: "TECNICA", listRoute: "/interno/mis-ordenes", listLabel: "Mis órdenes" }));
  assert.ok(content(tree).includes("Ya no tienes acceso técnico a esta orden"));
  assert.equal(pressable(tree, "Reintentar consulta"), undefined);
  await press(tree, "Volver a Mis órdenes");
  assert.equal(h.moves.at(-1), "/interno/mis-ordenes");
  await act(async () => tree.unmount());
});

test("Mis órdenes requests vista=TECNICA, shows the empty state and opens the technical route", async () => {
  let rows = [];
  const backendCalls = server();
  const request = async (url, options) => url.startsWith("/interno/ordenes?")
    ? (backendCalls.calls.push({ url }), { data: rows }) : backendCalls.request(url, options);
  const h = harness({ request, roles: ["MECANICO"] });
  const tree = await mount(React.createElement(h.list.OrderListScreen, { repository: h.repository.realOrderRepository, realTechnical: true }));
  assert.ok(backendCalls.calls.some(({ url }) => url.startsWith("/interno/ordenes?") && url.includes("vista=TECNICA")));
  assert.ok(content(tree).includes("Sin órdenes asignadas"));
  assert.ok(content(tree).includes("Mis órdenes"));
  rows = [base];
  await act(async () => tree.update(React.createElement(h.list.OrderListScreen,
    { repository: h.repository.realOrderRepository, realTechnical: true, key: "reload" })));
  const item = tree.root.findAllByType("Pressable").find((node) => node.props.accessibilityHint === "Abre el detalle de la orden");
  await act(async () => item.props.onPress());
  assert.deepEqual(plain(h.moves.at(-1)), { pathname: "/interno/mis-ordenes/[id]", params: { id: "21" } });
  assert.equal(content(tree).includes("Cliente TT026"), false);
  await act(async () => tree.unmount());
});
