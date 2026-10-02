import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { ProductHeader } from "../../components/ProductHeader";
import { Button, Choices, Field, KeyValue, Loading, Notice, errorMessage, styles,
  useCommandIntent } from "./CustomerVehicleComponents";
import { customerVehicleRepository as repository } from "./customerVehicleRepository";

const { validateCustomerForm, customerBody, customerChanges, customerToForm,
  serverFieldErrors } = require("./customerVehicleForms.cjs");

const ACTIVE_FILTERS = [{ value: "", label: "Todos" }, { value: "true", label: "Activos" }, { value: "false", label: "Inactivos" }];
const ACCESS = Object.freeze({ SIN_CUENTA: "Sin cuenta digital", ACTIVO: "Cuenta digital activa", DESACTIVADO: "Cuenta digital desactivada" });
const EMPTY_FORM = Object.freeze({ nombre: "", telefono: "", email: "", direccion: "", nit: "" });

function ProfileFields({ form, setForm, errors, disabled }) {
  const bind = (field) => ({ value: form[field], editable: !disabled, error: errors[field],
    onChangeText: (value) => setForm((current) => ({ ...current, [field]: value })) });
  return <>
    <Field label="Nombre" required maxLength={200} {...bind("nombre")} />
    <Field label="Teléfono" keyboardType="phone-pad" maxLength={30} {...bind("telefono")} />
    <Field label="Correo electrónico" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={254} {...bind("email")} />
    <Field label="Dirección" multiline maxLength={500} {...bind("direccion")} />
    <Field label="NIT" autoCapitalize="characters" maxLength={30} {...bind("nit")} />
  </>;
}

export function usePagedList(load, dependencies) {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(null);
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const fetchPage = useCallback(async (cursor = null) => {
    const current = ++generation.current;
    setState(cursor ? "more" : "loading"); setError("");
    try {
      const result = await load(cursor);
      if (current !== generation.current) return;
      setRows((previous) => cursor ? [...new Map([...previous, ...result.data].map((row) => [row.id, row])).values()] : result.data);
      setPage(result.page); setState("ready");
    } catch (failure) {
      if (current === generation.current) { setError(errorMessage(failure)); setState(cursor ? "ready" : "error"); }
    }
  }, dependencies);
  useFocusEffect(useCallback(() => { void fetchPage(); return () => { generation.current += 1; }; }, [fetchPage]));
  return { rows, page, state, error, reload: () => fetchPage(), more: () => page?.siguienteCursor && fetchPage(page.siguienteCursor) };
}

export function CustomerListScreen() {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  const [filters, setFilters] = useState({ q: "", activo: "" });
  const [searchError, setSearchError] = useState("");
  const list = usePagedList((cursor) => repository.listCustomers({ q: filters.q, activo: filters.activo, cursor }), [filters]);
  return <ScreenContainer fullSafeArea><View style={styles.stack}>
    <ProductHeader title="Clientes" context="Perfiles comerciales del taller. No crean cuentas digitales." />
    <Button onPress={() => router.push("/interno/gestion/clientes/nuevo")}>Registrar cliente</Button>
    <Field label="Buscar por nombre, teléfono, correo o NIT" value={search} onChangeText={setSearch} maxLength={100}
      autoCorrect={false} error={searchError} />
    <Choices label="Estado" options={ACTIVE_FILTERS} value={active} onChange={setActive} />
    <Button variant="secondary" disabled={list.state === "loading"} onPress={() => {
      if (search.trim().length === 1) { setSearchError("Escribe al menos dos caracteres para buscar."); return; }
      setSearchError(""); setFilters({ q: search.trim(), activo: active });
    }}>Buscar</Button>
    {list.state === "loading" ? <Loading label="Cargando clientes" /> : null}
    {list.state === "error" ? <><Notice value={list.error} /><Button variant="secondary" onPress={list.reload}>Reintentar</Button></> : null}
    {list.state !== "loading" && list.state !== "error" && list.rows.length === 0
      ? <Text style={styles.text}>{filters.q ? "No hay clientes que coincidan con la búsqueda." : "Todavía no hay clientes con este filtro."}</Text> : null}
    {list.rows.map((row) => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`Abrir cliente ${row.nombre}`}
      onPress={() => router.push(`/interno/gestion/clientes/${row.id}`)} style={styles.row}>
      <Text style={styles.label}>{row.nombre}</Text>
      <Text style={styles.hint}>{[row.telefono, row.email, row.nit].filter(Boolean).join(" · ") || "Sin contacto registrado"}</Text>
      <Text style={styles.hint}>{row.activo ? "Activo" : "Inactivo"} · {ACCESS[row.accesoDigital] ?? "Acceso no reconocido"}</Text>
    </Pressable>)}
    {list.error && list.state === "ready" ? <Notice value={list.error} /> : null}
    {list.page?.hayMas ? <Button variant="secondary" disabled={list.state === "more"} onPress={list.more}>
      {list.state === "more" ? "Cargando…" : "Cargar más"}</Button> : null}
    {list.state === "ready" ? <Button variant="secondary" onPress={list.reload}>Actualizar</Button> : null}
  </View></ScreenContainer>;
}

export function NewCustomerScreen() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const command = useCommandIntent();
  const locked = command.busy || command.pending;
  async function submit() {
    if (!command.pending) {
      const validation = validateCustomerForm(form);
      setErrors(validation);
      if (Object.keys(validation).length) { setError("Revisa los campos marcados."); return; }
    }
    setError("");
    try {
      const data = await command.run("/interno/clientes", customerBody(form));
      setCreated({ id: data.clienteId, nombre: form.nombre.trim() });
    } catch (failure) {
      setErrors(serverFieldErrors(failure)); setError(errorMessage(failure));
    }
  }
  if (created) {
    return <ScreenContainer><View style={styles.stack}>
      <Text accessibilityRole="header" style={styles.title}>Cliente registrado</Text>
      <Text style={styles.text}>{created.nombre} quedó activo, sin cuenta digital ni credenciales.</Text>
      <Button onPress={() => router.replace(`/interno/gestion/vehiculos/nuevo?propietarioId=${created.id}`)}>Registrar vehículo de este cliente</Button>
      <Button variant="secondary" onPress={() => router.replace(`/interno/gestion/clientes/${created.id}`)}>Ver cliente</Button>
    </View></ScreenContainer>;
  }
  return <ScreenContainer><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.stack}>
    <Text style={styles.hint}>Solo el nombre es obligatorio. Registrar un cliente no crea usuario ni acceso a la app.</Text>
    <ProfileFields form={form} setForm={setForm} errors={errors} disabled={locked} />
    <Notice value={error} />
    <Button disabled={command.busy} onPress={submit}>
      {command.busy ? "Registrando…" : command.pending ? "Reintentar el mismo registro" : "Registrar cliente"}</Button>
  </KeyboardAvoidingView></ScreenContainer>;
}

function describeDraft(draft) {
  return Object.entries(draft).map(([field, value]) => `${field}: ${value ?? "(vacío)"}`).join(" · ");
}

export function CustomerDetailScreen() {
  const { id } = useLocalSearchParams();
  const [customer, setCustomer] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [state, setState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState({ text: "", tone: "success" });
  const [discarded, setDiscarded] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState("");
  const command = useCommandIntent();
  const reload = useCallback(async () => {
    setState("loading"); setLoadError("");
    try {
      const fresh = await repository.getCustomer(id);
      setCustomer(fresh); setForm(customerToForm(fresh)); setErrors({}); setState("ready");
      return fresh;
    } catch (failure) { setLoadError(errorMessage(failure)); setState("error"); return null; }
  }, [id]);
  useEffect(() => { void reload(); }, [reload]);
  const vehicles = usePagedList((cursor) => repository.listVehicles({ clienteId: id, cursor }), [id]);
  const changes = customer ? customerChanges(customer, form) : {};
  const hasChanges = Object.keys(changes).length > 0;

  async function save() {
    const validation = validateCustomerForm(form);
    setErrors(validation); setDiscarded(null);
    if (Object.keys(validation).length) { setMessage({ text: "Revisa los campos marcados.", tone: "error" }); return; }
    setSaving(true); setMessage({ text: "", tone: "success" });
    try {
      const updated = await repository.updateCustomer(id, customer.version, changes);
      setCustomer(updated); setForm(customerToForm(updated));
      setMessage({ text: "Cambios guardados.", tone: "success" });
    } catch (failure) {
      if (failure.code === "VERSION_DESACTUALIZADA" || failure.uncertain) {
        // Never overwrite: reload the authoritative version and require a new human decision.
        setDiscarded(changes);
        await reload();
        setMessage({ text: failure.uncertain
          ? "No se pudo confirmar si se guardó. Se recargó la versión actual: compárala antes de volver a guardar."
          : errorMessage(failure), tone: "error" });
      } else {
        setErrors(serverFieldErrors(failure)); setMessage({ text: errorMessage(failure), tone: "error" });
      }
    } finally { setSaving(false); }
  }

  function confirmDeactivation() {
    if (!reason.trim()) { setMessage({ text: "Indica el motivo de la desactivación.", tone: "error" }); return; }
    Alert.alert("Desactivar cliente", `${customer.nombre} no podrá recibir vehículos ni nuevas órdenes. Su historia, órdenes y deuda se conservan. Una cuenta digital, si existiera, no se modifica.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Desactivar cliente", style: "destructive", onPress: async () => {
        try {
          await command.run(`/interno/clientes/${id}/desactivar`, { versionEsperada: customer.version, motivo: reason.trim() });
          setReason(""); await reload(); setMessage({ text: "Cliente desactivado.", tone: "success" });
        } catch (failure) {
          if (failure.code === "VERSION_DESACTUALIZADA" || failure.code === "ESTADO_INCOMPATIBLE") await reload();
          setMessage({ text: errorMessage(failure), tone: "error" });
        }
      } },
    ]);
  }

  const locked = saving || command.busy || command.pending || state !== "ready";
  return <ScreenContainer><View style={styles.stack}>
    {state === "loading" ? <Loading label="Cargando cliente" /> : null}
    {state === "error" ? <><Notice value={loadError} /><Button variant="secondary" onPress={reload}>Reintentar</Button></> : null}
    {customer ? <>
      <Text accessibilityRole="header" style={styles.title}>{customer.nombre}</Text>
      <KeyValue label="Estado" value={customer.activo ? "Activo" : "Inactivo"} />
      <KeyValue label="Acceso digital" value={ACCESS[customer.accesoDigital] ?? "No reconocido"} />
      <Notice value={message.text} tone={message.tone} />
      {discarded ? <Text style={styles.warning}>Tu borrador no guardado era: {describeDraft(discarded)}</Text> : null}

      <Text style={styles.section}>Vehículos actuales</Text>
      {vehicles.state === "loading" ? <Loading label="Cargando vehículos" /> : null}
      {vehicles.state === "error" ? <><Notice value={vehicles.error} /><Button variant="secondary" onPress={vehicles.reload}>Reintentar vehículos</Button></> : null}
      {vehicles.state === "ready" && vehicles.rows.length === 0 ? <Text style={styles.hint}>Este cliente no es propietario actual de ningún vehículo.</Text> : null}
      {vehicles.rows.map((row) => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`Abrir vehículo ${row.placa || row.marca}`}
        onPress={() => router.push(`/interno/gestion/vehiculos/${row.id}`)} style={styles.row}>
        <Text style={styles.label}>{row.placa || "Sin placa"} · {row.marca} {row.modelo}</Text>
        <Text style={styles.hint}>{row.tipoVehiculo}{row.anio ? ` · ${row.anio}` : ""}{row.activo ? "" : " · Inactivo"}</Text>
      </Pressable>)}
      {vehicles.page?.hayMas ? <Button variant="secondary" onPress={vehicles.more}>Cargar más vehículos</Button> : null}
      {customer.activo
        ? <Button onPress={() => router.push(`/interno/gestion/vehiculos/nuevo?propietarioId=${customer.id}`)}>Registrar vehículo</Button>
        : <Text style={styles.hint}>Un cliente inactivo no puede recibir vehículos nuevos.</Text>}

      <Text style={styles.section}>Perfil</Text>
      <ProfileFields form={form} setForm={setForm} errors={errors} disabled={locked} />
      <Button disabled={locked || !hasChanges} onPress={save}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
      {!hasChanges ? <Text style={styles.hint}>Modifica algún campo para habilitar el guardado.</Text> : null}

      {customer.activo ? <>
        <Text style={styles.section}>Desactivar</Text>
        <Field label="Motivo de desactivación" required multiline maxLength={500} value={reason} onChangeText={setReason} editable={!locked} />
        <Button variant="danger" disabled={locked} onPress={confirmDeactivation}>Desactivar cliente</Button>
      </> : null}
      {command.pending ? <Button disabled={command.busy} onPress={confirmDeactivation}>Reintentar la misma desactivación</Button> : null}
      <Button variant="secondary" disabled={saving || command.busy} onPress={() => { setDiscarded(null); setMessage({ text: "", tone: "success" }); void reload(); vehicles.reload(); }}>Recargar</Button>
    </> : null}
  </View></ScreenContainer>;
}
