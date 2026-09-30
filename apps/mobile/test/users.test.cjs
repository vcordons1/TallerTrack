const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("react");
// npm workspaces may hoist the renderer beside a different React peer.
// Render with the exact React instance used by this mobile workspace.
const Module = require("node:module");
const rendererPath = require.resolve("react-test-renderer/cjs/react-test-renderer.development.js");
const rendererModule = new Module(rendererPath, module);
rendererModule.filename = rendererPath;
rendererModule.require = (name) => name === "react" ? React : Module.createRequire(rendererPath)(name);
rendererModule._compile(fs.readFileSync(rendererPath, "utf8"), rendererPath);
const { act, create } = rendererModule.exports;
const babel = require("@babel/core");
const { createUserCommand, validateUser } = require("../src/features/users/userFlow.cjs");
global.IS_REACT_ACT_ENVIRONMENT = true;

test("uncertain creation keeps original password/body/key and guards double submit", async () => {
  const calls = []; let release;
  const flow = createUserCommand({ uuid: () => "key-1", request: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) { await new Promise((resolve) => { release = resolve; }); throw { uncertain: true }; }
    return { data: { usuarioId: "7" } };
  } });
  const body = { roles: ["RECEPCIONISTA"], password: "employee-chosen-password" };
  const first = flow.run("/interno/usuarios", body);
  await assert.rejects(flow.run("/interno/usuarios", body), /enviando/);
  body.roles.push("ADMINISTRADOR"); release(); await assert.rejects(first);
  assert.equal(flow.pending, true);
  await flow.run("changed", { password: "changed" });
  assert.deepEqual(calls[0], calls[1]); assert.equal(flow.pending, false);
  assert.equal(validateUser({ login: "a", nombreMostrado: "Empleado", roles: [], password: "123456789012" }), "Selecciona al menos un rol interno.");
});

function harness({ request, roles = ["ADMINISTRADOR"] }) {
  const moves = []; const confirmations = [];
  const navigation = { addListener: () => () => {} };
  const session = { access: { tipoActor: "INTERNO", usuarioId: "1", roles }, refreshIdentity: async () => {} };
  const module = { exports: {} };
  const source = babel.transformSync(fs.readFileSync(path.join(__dirname, "../src/features/users/UserScreens.js"), "utf8"), {
    babelrc: false, configFile: false,
    plugins: [["@babel/plugin-transform-react-jsx", { runtime: "automatic" }], "@babel/plugin-transform-modules-commonjs"],
  }).code;
  const requireMock = (name) => {
    if (name === "expo-router/react-navigation") return { usePreventRemove: () => {} };
    if (name === "expo-router") return { router: { push: (url) => moves.push(url), replace: (url) => moves.push(url) },
      useFocusEffect: (fn) => React.useEffect(fn, [fn]), useLocalSearchParams: () => ({ id: "7" }), useNavigation: () => navigation };
    if (name === "expo-crypto") return { randomUUID: () => "test-key" };
    if (name === "react-native") return { ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View",
      KeyboardAvoidingView: "KeyboardAvoidingView", Platform: { OS: "android" }, StyleSheet: { create: (s) => s },
      Alert: { alert: (...args) => confirmations.push(args) } };
    if (name.endsWith("api/runtime")) return { api: { request } };
    if (name.endsWith("session/SessionProvider")) return { useSession: () => session };
    if (name.endsWith("ScreenContainer")) return { ScreenContainer: "ScreenContainer" };
    if (name.endsWith("ProductHeader")) return { ProductHeader: "ProductHeader" };
    if (name.endsWith("theme/tokens")) return { colors: {}, radii: {}, spacing: {}, typography: {} };
    if (name === "./userFlow.cjs") return require("../src/features/users/userFlow.cjs");
    return require(name);
  };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { console, URLSearchParams })(requireMock, module, module.exports);
  return { ...module.exports, moves, confirmations };
}
const content = (tree) => JSON.stringify(tree.toJSON());
const button = (tree, text) => tree.root.findAllByType("Pressable").find((node) =>
  node.findAllByType("Text").some((t) => t.children.includes(text)));
async function mount(Component) { let tree; await act(async () => { tree = create(React.createElement(Component)); }); return tree; }

test("list renders loading, empty, error/retry, data and detail navigation", async () => {
  let resolve; let stage = "loading";
  const h = harness({ request: async () => {
    if (stage === "loading") return new Promise((r) => { resolve = r; });
    if (stage === "error") throw new Error("Servicio temporalmente no disponible");
    return { data: [{ id: "7", nombreMostrado: "Elena", login: "elena", activo: true, roles: ["RECEPCIONISTA"] }], page: { hayMas: false } };
  } });
  const tree = await mount(h.UserListScreen);
  assert.ok(content(tree).includes("Cargando usuarios"));
  await act(async () => resolve({ data: [], page: { hayMas: false } }));
  assert.ok(content(tree).includes("No hay usuarios"));
  stage = "error"; await act(async () => button(tree, "Actualizar").props.onPress());
  assert.ok(content(tree).includes("Servicio temporalmente"));
  stage = "data"; await act(async () => button(tree, "Actualizar").props.onPress());
  assert.ok(content(tree).includes("Elena"));
  await act(async () => tree.root.findByProps({ accessibilityLabel: "Abrir Elena" }).props.onPress());
  assert.deepEqual(h.moves, ["/interno/gestion/usuarios/7"]);
  await act(async () => tree.unmount());
});

test("create form validates roles, displays API error, clears secret and opens confirmed detail", async () => {
  const calls = []; let reject = true;
  const h = harness({ request: async (url, options) => { calls.push({ url, options });
    if (reject) throw { code: "REFERENCIA_DUPLICADA" }; return { data: { usuarioId: "7" } }; } });
  const tree = await mount(h.NewUserScreen);
  const field = (label) => tree.root.findAllByType("TextInput").find((n) => n.props.accessibilityLabel === label);
  await act(async () => {
    field("Nombre mostrado").props.onChangeText("Elena"); field("Usuario de acceso").props.onChangeText("elena");
    field("Contraseña elegida por el empleado").props.onChangeText("employee-password"); field("Repetir contraseña").props.onChangeText("employee-password");
  });
  await act(async () => button(tree, "Crear usuario").props.onPress());
  assert.ok(content(tree).includes("Selecciona al menos un rol")); assert.equal(calls.length, 0);
  await act(async () => tree.root.findByProps({ accessibilityRole: "checkbox", accessibilityLabel: "RECEPCIONISTA" }).props.onPress());
  await act(async () => button(tree, "Crear usuario").props.onPress());
  assert.ok(content(tree).includes("ya existe"));
  reject = false; await act(async () => button(tree, "Crear usuario").props.onPress());
  assert.ok(content(tree).includes("Usuario creado")); assert.equal(content(tree).includes("employee-password"), false);
  await act(async () => button(tree, "Ver usuario").props.onPress());
  assert.deepEqual(h.moves, ["/interno/gestion/usuarios/7"]);
  await act(async () => tree.unmount());
});

test("detail confirms mutations, requires human reload after stale version, then deactivates", async () => {
  let version = "1"; let active = true; let stale = true; const writes = [];
  const h = harness({ request: async (url, options) => {
    if (!options) return { data: { id: "7", version, nombreMostrado: "Elena", login: "elena", activo: active, roles: ["RECEPCIONISTA"] } };
    writes.push(options.body);
    if (stale) { version = "2"; throw { code: "VERSION_DESACTUALIZADA" }; }
    if (url.endsWith("desactivar")) active = false;
    return { data: { usuarioId: "7", version: "3" } };
  } });
  const tree = await mount(h.UserDetailScreen);
  const reason = () => tree.root.findAllByType("TextInput").find((n) => n.props.accessibilityLabel === "Motivo del cambio");
  await act(async () => reason().props.onChangeText("Cambio de función"));
  await act(async () => button(tree, "Guardar roles").props.onPress());
  assert.equal(writes.length, 0); assert.equal(h.confirmations.length, 1);
  await act(async () => h.confirmations.at(-1)[2][1].onPress());
  assert.ok(content(tree).includes("Recargar y revisar"));
  assert.equal(button(tree, "Guardar roles").props.disabled, true); assert.equal(writes.length, 1);
  await act(async () => button(tree, "Recargar y revisar").props.onPress());
  stale = false;
  await act(async () => reason().props.onChangeText("Fin de relación"));
  await act(async () => button(tree, "Desactivar usuario").props.onPress());
  assert.equal(h.confirmations.at(-1)[2][1].style, "destructive");
  await act(async () => h.confirmations.at(-1)[2][1].onPress());
  assert.equal(writes.at(-1).versionEsperada, "2"); assert.ok(content(tree).includes("Inactivo"));
  await act(async () => tree.unmount());
});

test("non-administrator cannot render user administration", async () => {
  const h = harness({ request: async () => { throw new Error("must not query"); }, roles: ["RECEPCIONISTA"] });
  let tree; await act(async () => { tree = create(React.createElement(h.UserBoundary, null, React.createElement(h.UserListScreen))); });
  assert.ok(content(tree).includes("No tienes permiso")); assert.equal(content(tree).includes("Crear usuario"), false);
  await act(async () => tree.unmount());
});
