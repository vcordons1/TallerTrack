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

const forms = require("../src/features/customers-vehicles/customerVehicleForms.cjs");
const { createCommandIntent } = require("../src/api/commandIntent.cjs");
const { CAPABILITIES, hasInternalCapability, ROLES } = require("../src/navigation/accessPolicy");
global.IS_REACT_ACT_ENVIRONMENT = true;

test("customer form: only nombre required, empty optionals omitted, edits send only real changes", () => {
  assert.deepEqual(forms.validateCustomerForm({ nombre: "  " }), { nombre: "Ingresa el nombre del cliente." });
  assert.deepEqual(forms.validateCustomerForm({ nombre: "Ana", telefono: "x".repeat(31) }), { telefono: "Máximo 30 caracteres." });
  // No invented contact format: any non-empty text within the contract length is accepted.
  assert.deepEqual(forms.validateCustomerForm({ nombre: "Ana", telefono: "+502 5555-0000 ext. 2", email: "sin arroba" }), {});
  assert.deepEqual(forms.customerBody({ nombre: " Ana ", telefono: "", email: " a@b.gt ", direccion: " ", nit: "" }),
    { nombre: "Ana", email: "a@b.gt" });
  const original = { nombre: "Ana", telefono: "5555", email: null, direccion: null, nit: "CF" };
  assert.deepEqual(forms.customerChanges(original, { nombre: "Ana", telefono: "", email: "", direccion: "Zona 1", nit: "CF" }),
    { telefono: null, direccion: "Zona 1" });
  assert.deepEqual(forms.customerChanges(original, forms.customerToForm(original)), {});
});

test("vehicle form: contract limits only, identifiers optional and normalized, no authority fields", () => {
  const form = { ownerId: "5", tipoVehiculo: "AUTOMOVIL", placa: " p-1 ", vin: "", marca: "Toyota", modelo: "Hilux",
    anio: "2020", color: "", motivoPropiedad: " Alta " };
  assert.deepEqual(forms.validateVehicleForm(form, { registration: true }), {});
  assert.deepEqual(forms.vehicleRegistrationBody(form), { vehiculo: { tipoVehiculo: "AUTOMOVIL", placa: "P-1",
    marca: "Toyota", modelo: "Hilux", anio: 2020 }, propietarioId: "5", motivoPropiedad: "Alta" });
  const errors = forms.validateVehicleForm({ tipoVehiculo: "", marca: "", modelo: "M", anio: "20a0", placa: "x".repeat(21) },
    { registration: true });
  assert.deepEqual(Object.keys(errors).sort(), ["anio", "marca", "motivoPropiedad", "ownerId", "placa", "tipoVehiculo"]);
  assert.deepEqual(forms.validateVehicleForm({ tipoVehiculo: "OTRO", marca: "A", modelo: "B", placa: "#?¿ñ 1" }), {},
    "no plate regex (G-05 open)");
  const vehicle = { tipoVehiculo: "AUTOMOVIL", placa: "P-1", vin: null, marca: "Toyota", modelo: "Hilux", anio: 2020, color: null };
  assert.deepEqual(forms.vehicleChanges(vehicle, { ...forms.vehicleToForm(vehicle), placa: "", anio: "", color: "Rojo" }),
    { placa: null, anio: null, color: "Rojo" });
  assert.deepEqual(forms.transferBody({ propiedadActual: { id: "11", clienteId: "5" } }, "6", " Venta "),
    { propiedadEsperadaId: "11", propietarioEsperadoId: "5", nuevoPropietarioId: "6", motivo: "Venta" });
});

test("server field pointers and uncertain results become actionable messages", () => {
  assert.deepEqual(forms.serverFieldErrors({ fields: [{ path: "/vehiculo/placa", code: "REFERENCIA_DUPLICADA" },
    { path: "/propietarioId", code: "VALIDACION_DOMINIO" }, { path: "/cambios/vin", code: "REFERENCIA_DUPLICADA" }] }),
  { placa: "Ya existe otro vehículo con este valor.", ownerId: "Valor no disponible actualmente.", vin: "Ya existe otro vehículo con este valor." });
  assert.match(forms.customerVehicleMessage({ uncertain: true, code: "ERROR_INTERNO" }), /misma operación/);
  assert.match(forms.customerVehicleMessage({ code: "VERSION_DESACTUALIZADA" }), /cambiaron/);
});

test("K intent keeps key/body only while the result is uncertain and blocks double submit", async () => {
  const calls = []; let mode = "uncertain"; let release;
  const intent = createCommandIntent({ uuid: (() => { let n = 0; return () => `key-${++n}`; })(),
    request: async (url, options) => {
      calls.push({ url, key: options.headers["Idempotency-Key"], body: options.body, uncertain: options.uncertainBusinessResult });
      if (mode === "wait") await new Promise((resolve) => { release = resolve; });
      if (mode === "uncertain") throw { uncertain: true };
      if (mode === "rejected") throw { code: "VALIDACION_DOMINIO" };
      return { data: { vehiculoId: "9" } };
    } });
  const body = { vehiculo: { placa: "P1" } };
  await assert.rejects(intent.run("/interno/vehiculos", body));
  body.vehiculo.placa = "CHANGED";
  mode = "ok";
  assert.deepEqual(await intent.run("/interno/vehiculos", { other: true }), { vehiculoId: "9" });
  assert.deepEqual(calls[0], calls[1]); assert.equal(calls[1].body.vehiculo.placa, "P1"); assert.equal(calls[0].uncertain, true);
  mode = "rejected";
  await assert.rejects(intent.run("/interno/clientes", { nombre: "A" }));
  assert.equal(intent.pending, false);
  mode = "wait";
  const first = intent.run("/interno/clientes", { nombre: "B" });
  await assert.rejects(intent.run("/interno/clientes", { nombre: "B" }), /enviando/);
  release(); await first;
  assert.notEqual(calls.at(-1).key, calls[0].key);
});

test("only A/R receive the customer/vehicle capability; no inheritance for M/I", () => {
  for (const roles of [[ROLES.ADMINISTRADOR], [ROLES.RECEPCIONISTA], [ROLES.MECANICO, ROLES.RECEPCIONISTA]]) {
    assert.equal(hasInternalCapability(roles, CAPABILITIES.CUSTOMERS_VEHICLES), true, roles.join());
  }
  for (const roles of [[ROLES.MECANICO], [ROLES.INVENTARIO], [ROLES.CLIENTE], []]) {
    assert.equal(hasInternalCapability(roles, CAPABILITIES.CUSTOMERS_VEHICLES), false, roles.join());
  }
});

// --- Rendered screens -------------------------------------------------------------------
const FEATURE = path.join(__dirname, "../src/features/customers-vehicles");

function harness({ request, roles = ["RECEPCIONISTA"], params = {} }) {
  const moves = []; const alerts = []; const shares = [];
  const session = { access: { tipoActor: "INTERNO", usuarioId: "1", roles } };
  const cache = new Map();
  let uuid = 0;
  const mocks = {
    "expo-router": { router: { push: (url) => moves.push(url), replace: (url) => moves.push(url) },
      useFocusEffect: (fn) => React.useEffect(fn, [fn]), useLocalSearchParams: () => params },
    "expo-router/react-navigation": { usePreventRemove: () => {} },
    "expo-crypto": { randomUUID: () => `ui-key-${++uuid}` },
    "react-native": { ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", TextInput: "TextInput",
      View: "View", KeyboardAvoidingView: "KeyboardAvoidingView", Platform: { OS: "android" }, StyleSheet: { create: (s) => s },
      Alert: { alert: (...args) => alerts.push(args) }, Share: { share: async (value) => { shares.push(value); } } },
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
      if (name.endsWith("theme/tokens")) return { colors: {}, radii: {}, spacing: {}, typography: {} };
      if (name.startsWith(".")) {
        const resolved = path.resolve(path.dirname(file), name);
        if (resolved.endsWith(".cjs")) return require(resolved);
        if (resolved.startsWith(FEATURE) && fs.existsSync(`${resolved}.js`)) return load(`${resolved}.js`);
        return require(resolved);
      }
      return require(name);
    };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { console, URLSearchParams, setTimeout, clearTimeout, Promise })(
      localRequire, module, module.exports);
    return module.exports;
  }
  return { customers: load(path.join(FEATURE, "CustomerScreens.js")), vehicles: load(path.join(FEATURE, "VehicleScreens.js")),
    components: load(path.join(FEATURE, "CustomerVehicleComponents.js")), moves, alerts, shares };
}

const content = (tree) => JSON.stringify(tree.toJSON());
// Objects created inside the vm realm have foreign prototypes; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const pressable = (tree, text) => tree.root.findAllByType("Pressable").find((node) =>
  node.findAllByType("Text").some((t) => t.children.join("") === text));
const input = (tree, label) => tree.root.findAllByType("TextInput").find((n) => n.props.accessibilityLabel === label);
async function mount(Component) { let tree; await act(async () => { tree = create(React.createElement(Component)); }); return tree; }
const customer = { id: "5", version: "1", nombre: "Ana López", telefono: "5555", email: null, direccion: null,
  nit: null, activo: true, accesoDigital: "SIN_CUENTA" };
const vehicle = { id: "9", tipoVehiculo: "AUTOMOVIL", placa: "P-1", vin: null, marca: "Toyota", modelo: "Hilux", anio: 2020,
  color: null, activo: true, version: "1", propiedadActual: { id: "11", clienteId: "5", nombreCliente: "Ana López",
    desdeEn: "2026-09-30T15:00:00.000000Z" }, qr: { generacionId: "13", estado: "VIGENTE",
    emitidoEn: "2026-09-30T15:00:00.000000Z", expiraEn: null }, ordenActivaId: null };
const types = [{ codigo: "AUTOMOVIL", nombre: "Automovil", activo: true }, { codigo: "OTRO", nombre: "Otro", activo: true }];

test("customer list renders loading, empty, error/retry, data and opens detail", async () => {
  let stage = "loading"; let resolve;
  const h = harness({ request: async () => {
    if (stage === "loading") return new Promise((r) => { resolve = r; });
    if (stage === "error") throw { message: "Servicio temporalmente no disponible" };
    return { data: [customer], page: { hayMas: false, siguienteCursor: null } };
  } });
  const tree = await mount(h.customers.CustomerListScreen);
  assert.ok(content(tree).includes("Cargando clientes"));
  await act(async () => resolve({ data: [], page: { hayMas: false } }));
  assert.ok(content(tree).includes("Todavía no hay clientes"));
  stage = "error"; await act(async () => pressable(tree, "Actualizar").props.onPress());
  assert.ok(content(tree).includes("Servicio temporalmente"));
  stage = "data"; await act(async () => pressable(tree, "Reintentar").props.onPress());
  assert.ok(content(tree).includes("Ana López"));
  await act(async () => tree.root.findByProps({ accessibilityLabel: "Abrir cliente Ana López" }).props.onPress());
  assert.deepEqual(h.moves, ["/interno/gestion/clientes/5"]);
  await act(async () => tree.unmount());
});

test("new customer validates, shows API errors, retries uncertain with same key and offers vehicle registration", async () => {
  const calls = []; let mode = "uncertain";
  const h = harness({ request: async (url, options) => { calls.push({ url, options });
    if (mode === "uncertain") throw { uncertain: true };
    return { data: { clienteId: "5", version: "1" } }; } });
  const tree = await mount(h.customers.NewCustomerScreen);
  await act(async () => pressable(tree, "Registrar cliente").props.onPress());
  assert.equal(calls.length, 0); assert.ok(content(tree).includes("Ingresa el nombre del cliente."));
  await act(async () => { input(tree, "Nombre").props.onChangeText(" Ana López "); input(tree, "Teléfono").props.onChangeText("5555"); });
  await act(async () => pressable(tree, "Registrar cliente").props.onPress());
  assert.ok(content(tree).includes("misma operación"));
  assert.equal(input(tree, "Nombre").props.editable, false, "an uncertain intent freezes its body");
  mode = "ok";
  await act(async () => pressable(tree, "Reintentar el mismo registro").props.onPress());
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers["Idempotency-Key"], calls[1].options.headers["Idempotency-Key"]);
  assert.deepEqual(calls[1].options.body, { nombre: "Ana López", telefono: "5555" });
  assert.ok(content(tree).includes("Cliente registrado"));
  await act(async () => pressable(tree, "Registrar vehículo de este cliente").props.onPress());
  assert.deepEqual(h.moves, ["/interno/gestion/vehiculos/nuevo?propietarioId=5"]);
  await act(async () => tree.unmount());
});

test("customer detail edits with version, reloads on stale version and keeps the discarded draft visible", async () => {
  let server = { ...customer }; let stale = true; const patches = [];
  const h = harness({ params: { id: "5" }, request: async (url, options = {}) => {
    if (options.method === "PATCH") {
      patches.push(options.body);
      if (stale) { server = { ...server, version: "2", telefono: "7777" }; throw { code: "VERSION_DESACTUALIZADA" }; }
      server = { ...server, ...options.body.cambios, version: String(Number(server.version) + 1) };
      return { data: server };
    }
    if (url.startsWith("/interno/vehiculos")) return { data: [vehicle], page: { hayMas: false } };
    return { data: server };
  } });
  const tree = await mount(h.customers.CustomerDetailScreen);
  assert.ok(content(tree).includes("Toyota"));
  assert.equal(pressable(tree, "Guardar cambios").props.disabled, true);
  await act(async () => input(tree, "Correo electrónico").props.onChangeText("ana@taller.gt"));
  await act(async () => pressable(tree, "Guardar cambios").props.onPress());
  assert.deepEqual(plain(patches[0]), { versionEsperada: "1", cambios: { email: "ana@taller.gt" } });
  assert.ok(content(tree).includes("Los datos cambiaron"));
  assert.ok(content(tree).includes("Tu borrador no guardado era: ")); assert.ok(content(tree).includes("email: ana@taller.gt"));
  assert.equal(input(tree, "Teléfono").props.value, "7777");
  stale = false;
  await act(async () => input(tree, "Correo electrónico").props.onChangeText("ana@taller.gt"));
  await act(async () => pressable(tree, "Guardar cambios").props.onPress());
  assert.deepEqual(plain(patches[1]), { versionEsperada: "2", cambios: { email: "ana@taller.gt" } });
  assert.ok(content(tree).includes("Cambios guardados."));
  await act(async () => pressable(tree, "Registrar vehículo").props.onPress());
  assert.deepEqual(h.moves.at(-1), "/interno/gestion/vehiculos/nuevo?propietarioId=5");
  await act(async () => tree.unmount());
});

test("new vehicle uses V08 types and preselected owner, maps duplicate plate, then shows the one-time QR", async () => {
  const posts = []; let duplicate = true;
  const h = harness({ params: { propietarioId: "5" }, request: async (url, options = {}) => {
    if (url === "/interno/tipos-vehiculo") return { data: types };
    if (url === "/interno/clientes/5") return { data: customer };
    posts.push(options);
    if (duplicate) throw { code: "REFERENCIA_DUPLICADA", fields: [{ path: "/vehiculo/placa", code: "REFERENCIA_DUPLICADA" }] };
    return { data: { vehiculoId: "9", version: "1", propiedadId: "11", qr: vehicle.qr,
      emisionQr: { generacionId: "13", urlPublica: "https://taller.example/qr/SECRET_TOKEN_VALUE", emitidoEn: vehicle.qr.emitidoEn, expiraEn: null },
      requiereNuevaEmision: false } };
  } });
  const tree = await mount(h.vehicles.NewVehicleScreen);
  assert.ok(content(tree).includes("Ana López"));
  await act(async () => tree.root.findByProps({ accessibilityRole: "radio", accessibilityLabel: "Otro" }).props.onPress());
  await act(async () => { input(tree, "Placa").props.onChangeText("p-1"); input(tree, "Marca").props.onChangeText("Toyota");
    input(tree, "Modelo").props.onChangeText("Hilux"); input(tree, "Año").props.onChangeText("2020"); });
  await act(async () => pressable(tree, "Registrar vehículo").props.onPress());
  assert.equal(posts.length, 0, "motivo is required before any request");
  await act(async () => input(tree, "Motivo de la propiedad").props.onChangeText("Alta inicial"));
  await act(async () => pressable(tree, "Registrar vehículo").props.onPress());
  assert.deepEqual(plain(posts[0].body), { vehiculo: { tipoVehiculo: "OTRO", placa: "P-1", marca: "Toyota", modelo: "Hilux", anio: 2020 },
    propietarioId: "5", motivoPropiedad: "Alta inicial" });
  assert.ok(posts[0].headers["Idempotency-Key"]);
  assert.ok(content(tree).includes("Ya existe otro vehículo con este valor."));
  duplicate = false;
  await act(async () => input(tree, "Placa").props.onChangeText("P-2"));
  await act(async () => pressable(tree, "Registrar vehículo").props.onPress());
  assert.notEqual(posts[1].headers["Idempotency-Key"], posts[0].headers["Idempotency-Key"], "a rejected intent is not reused");
  assert.ok(content(tree).includes("Vehículo registrado"));
  assert.ok(content(tree).includes("https://taller.example/qr/SECRET_TOKEN_VALUE"));
  assert.ok(content(tree).includes("solo ahora"));
  await act(async () => pressable(tree, "Compartir enlace del QR").props.onPress());
  assert.deepEqual(plain(h.shares), [{ message: "https://taller.example/qr/SECRET_TOKEN_VALUE" }]);
  await act(async () => pressable(tree, "Ver vehículo").props.onPress());
  assert.deepEqual(h.moves, ["/interno/gestion/vehiculos/9"]);
  await act(async () => tree.unmount());
});

test("vehicle type loading failure offers retry and blocks submission", async () => {
  let fail = true;
  const h = harness({ request: async (url) => {
    if (url === "/interno/tipos-vehiculo") { if (fail) throw new Error("red"); return { data: types }; }
    throw new Error(`unexpected ${url}`);
  } });
  const tree = await mount(h.vehicles.NewVehicleScreen);
  assert.ok(content(tree).includes("No se pudieron cargar los tipos"));
  assert.equal(pressable(tree, "Registrar vehículo").props.disabled, true);
  fail = false;
  await act(async () => pressable(tree, "Reintentar tipos").props.onPress());
  assert.ok(tree.root.findByProps({ accessibilityRole: "radio", accessibilityLabel: "Automovil" }));
  await act(async () => tree.unmount());
});

test("vehicle detail shows current owner and QR state without any secret; transfer is explicit", async () => {
  const h = harness({ params: { id: "9" }, request: async (url) => {
    if (url === "/interno/tipos-vehiculo") return { data: types };
    return { data: vehicle };
  } });
  const tree = await mount(h.vehicles.VehicleDetailScreen);
  const text = content(tree);
  assert.ok(text.includes("Propietario actual")); assert.ok(text.includes("Ana López"));
  assert.ok(text.includes("Vigente")); assert.ok(text.includes("Sin orden activa."));
  assert.equal(text.includes("/qr/"), false);
  await act(async () => pressable(tree, "Transferir propietario").props.onPress());
  assert.deepEqual(h.moves, ["/interno/gestion/vehiculos/transferir/9"]);
  await act(async () => tree.root.findByProps({ accessibilityLabel: "Abrir propietario Ana López" }).props.onPress());
  assert.deepEqual(h.moves.at(-1), "/interno/gestion/clientes/5");
  await act(async () => tree.unmount());
});

test("vehicle detail starts a reception only for RECEPCIONISTA and only without an active order", async () => {
  for (const [roles, activeOrder, expected] of [
    [["RECEPCIONISTA"], null, true], [["ADMINISTRADOR"], null, false], [["RECEPCIONISTA"], "44", false],
  ]) {
    const h = harness({ roles, params: { id: "9" }, request: async (url) => {
      if (url === "/interno/tipos-vehiculo") return { data: types };
      return { data: { ...vehicle, ordenActivaId: activeOrder } };
    } });
    const tree = await mount(h.vehicles.VehicleDetailScreen);
    const action = pressable(tree, "Nueva recepción");
    assert.equal(action !== undefined, expected, `${roles} / ${activeOrder}`);
    if (action) {
      await act(async () => action.props.onPress());
      assert.deepEqual(plain(h.moves.at(-1)), { pathname: "/interno/ordenes/nueva", params: { vehiculoId: "9" } });
    }
    if (activeOrder) assert.ok(content(tree).includes("Ver orden activa #44"));
    await act(async () => tree.unmount());
  }
});

test("roles without the capability cannot render customer/vehicle maintenance", async () => {
  for (const roles of [["MECANICO"], ["INVENTARIO"]]) {
    const h = harness({ roles, request: async () => { throw new Error("must not query"); } });
    let tree;
    await act(async () => { tree = create(React.createElement(h.components.CustomerVehicleBoundary, null,
      React.createElement(h.customers.CustomerListScreen))); });
    assert.ok(content(tree).includes("No tienes permiso"));
    assert.equal(content(tree).includes("Registrar cliente"), false);
    await act(async () => tree.unmount());
  }
});
