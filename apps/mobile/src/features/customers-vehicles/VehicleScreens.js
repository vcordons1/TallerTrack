import { useCallback, useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { ProductHeader } from "../../components/ProductHeader";
import { Button, Choices, Field, KeyValue, Loading, Notice, OwnerPicker, QR_STATES, QrEmission, TypePicker,
  describeInstant, errorMessage, styles, useCommandIntent, useVehicleTypes } from "./CustomerVehicleComponents";
import { customerVehicleRepository as repository } from "./customerVehicleRepository";
import { usePagedList } from "./CustomerScreens";

const { validateVehicleForm, vehicleRegistrationBody, vehicleChanges, vehicleToForm, transferBody,
  serverFieldErrors } = require("./customerVehicleForms.cjs");

const ACTIVE_FILTERS = [{ value: "", label: "Todos" }, { value: "true", label: "Activos" }, { value: "false", label: "Inactivos" }];
const EMPTY_VEHICLE = Object.freeze({ tipoVehiculo: "", placa: "", vin: "", marca: "", modelo: "", anio: "", color: "" });
const IDENTIFIER_HINT = "Si el vehículo no tiene este dato, déjalo vacío: no escribas valores ficticios.";

function title(vehicle) {
  return `${vehicle.placa || "Sin placa"} · ${vehicle.marca} ${vehicle.modelo}`;
}

function VehicleFields({ form, setForm, errors, disabled, types }) {
  const bind = (field) => ({ value: form[field], editable: !disabled, error: errors[field],
    onChangeText: (value) => setForm((current) => ({ ...current, [field]: value })) });
  return <>
    <TypePicker {...types} value={form.tipoVehiculo} disabled={disabled} error={errors.tipoVehiculo} onRetry={types.reload}
      onChange={(value) => setForm((current) => ({ ...current, tipoVehiculo: value }))} />
    <Field label="Placa" autoCapitalize="characters" autoCorrect={false} maxLength={20} hint={IDENTIFIER_HINT} {...bind("placa")} />
    <Field label="VIN" autoCapitalize="characters" autoCorrect={false} maxLength={40} hint={IDENTIFIER_HINT} {...bind("vin")} />
    <Field label="Marca" required maxLength={80} {...bind("marca")} />
    <Field label="Modelo" required maxLength={80} {...bind("modelo")} />
    <Field label="Año" keyboardType="number-pad" maxLength={4} {...bind("anio")} />
    <Field label="Color" maxLength={50} {...bind("color")} />
  </>;
}

export function VehicleListScreen() {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  const [filters, setFilters] = useState({ q: "", activo: "" });
  const [searchError, setSearchError] = useState("");
  const list = usePagedList((cursor) => repository.listVehicles({ q: filters.q, activo: filters.activo, cursor }), [filters]);
  return <ScreenContainer fullSafeArea><View style={styles.stack}>
    <ProductHeader title="Vehículos" context="Cada vehículo tiene un único propietario actual y un QR vigente." />
    <Button onPress={() => router.push("/interno/gestion/vehiculos/nuevo")}>Registrar vehículo</Button>
    <Field label="Buscar por placa, VIN, marca o modelo" value={search} onChangeText={setSearch} maxLength={100}
      autoCapitalize="characters" autoCorrect={false} error={searchError} />
    <Choices label="Estado" options={ACTIVE_FILTERS} value={active} onChange={setActive} />
    <Button variant="secondary" disabled={list.state === "loading"} onPress={() => {
      if (search.trim().length === 1) { setSearchError("Escribe al menos dos caracteres para buscar."); return; }
      setSearchError(""); setFilters({ q: search.trim(), activo: active });
    }}>Buscar</Button>
    {list.state === "loading" ? <Loading label="Cargando vehículos" /> : null}
    {list.state === "error" ? <><Notice value={list.error} /><Button variant="secondary" onPress={list.reload}>Reintentar</Button></> : null}
    {list.state !== "loading" && list.state !== "error" && list.rows.length === 0
      ? <Text style={styles.text}>{filters.q ? "No hay vehículos que coincidan con la búsqueda." : "Todavía no hay vehículos con este filtro."}</Text> : null}
    {list.rows.map((row) => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`Abrir vehículo ${title(row)}`}
      onPress={() => router.push(`/interno/gestion/vehiculos/${row.id}`)} style={styles.row}>
      <Text style={styles.label}>{title(row)}</Text>
      <Text style={styles.hint}>Propietario: {row.propiedadActual.nombreCliente}</Text>
      <Text style={styles.hint}>{row.activo ? "Activo" : "Inactivo"} · QR {QR_STATES[row.qr.estado] ?? "no reconocido"}{row.ordenActivaId ? " · Con orden activa" : ""}</Text>
    </Pressable>)}
    {list.error && list.state === "ready" ? <Notice value={list.error} /> : null}
    {list.page?.hayMas ? <Button variant="secondary" disabled={list.state === "more"} onPress={list.more}>
      {list.state === "more" ? "Cargando…" : "Cargar más"}</Button> : null}
    {list.state === "ready" ? <Button variant="secondary" onPress={list.reload}>Actualizar</Button> : null}
  </View></ScreenContainer>;
}

export function NewVehicleScreen() {
  const { propietarioId } = useLocalSearchParams();
  const types = useVehicleTypes();
  const [owner, setOwner] = useState(null);
  const [ownerState, setOwnerState] = useState(propietarioId ? "loading" : "ready");
  const [form, setForm] = useState(EMPTY_VEHICLE);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const command = useCommandIntent();
  const locked = command.busy || command.pending;

  useEffect(() => {
    if (!propietarioId) return;
    let current = true;
    repository.getCustomer(propietarioId).then((customer) => {
      if (!current) return;
      if (customer.activo) setOwner(customer);
      else setError("El cliente indicado está inactivo. Selecciona un propietario activo.");
      setOwnerState("ready");
    }, (failure) => { if (current) { setError(errorMessage(failure)); setOwnerState("ready"); } });
    return () => { current = false; };
  }, [propietarioId]);

  async function submit() {
    const draft = { ...form, ownerId: owner?.id, motivoPropiedad: reason };
    if (!command.pending) {
      const validation = validateVehicleForm(draft, { registration: true });
      setErrors(validation);
      if (Object.keys(validation).length) { setError("Revisa los campos marcados."); return; }
    }
    setError("");
    try {
      // V02 is one complete intention: vehicle + first ownership + QR confirm together.
      const data = await command.run("/interno/vehiculos", vehicleRegistrationBody(draft));
      setCreated({ ...data, ownerName: owner.nombre, description: `${form.marca.trim()} ${form.modelo.trim()}` });
    } catch (failure) {
      setErrors(serverFieldErrors(failure)); setError(errorMessage(failure));
    }
  }

  if (created) {
    return <ScreenContainer><View style={styles.stack}>
      <Text accessibilityRole="header" style={styles.title}>Vehículo registrado</Text>
      <Text style={styles.text}>{created.description} quedó con {created.ownerName} como propietario actual.</Text>
      <KeyValue label="Estado del QR" value={`${QR_STATES[created.qr.estado] ?? created.qr.estado} · generación ${created.qr.generacionId}`} />
      <QrEmission emission={created.emisionQr} />
      <Button onPress={() => router.replace(`/interno/gestion/vehiculos/${created.vehiculoId}`)}>Ver vehículo</Button>
    </View></ScreenContainer>;
  }
  return <ScreenContainer><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.stack}>
    <Text style={styles.hint}>El vehículo, su propietario inicial y su QR se confirman juntos en el servidor.</Text>
    {ownerState === "loading" ? <Loading label="Cargando propietario" />
      : <OwnerPicker owner={owner} onChange={setOwner} disabled={locked} error={errors.ownerId} />}
    <VehicleFields form={form} setForm={setForm} errors={errors} disabled={locked} types={types} />
    <Field label="Motivo de la propiedad" required multiline maxLength={1000} value={reason} onChangeText={setReason}
      editable={!locked} error={errors.motivoPropiedad} placeholder="Ej. Alta inicial al recibirlo en el taller" />
    <Notice value={error} />
    <Button disabled={command.busy || types.state !== "ready"} onPress={submit}>
      {command.busy ? "Registrando…" : command.pending ? "Reintentar el mismo registro" : "Registrar vehículo"}</Button>
  </KeyboardAvoidingView></ScreenContainer>;
}

function PropertyHistory({ vehicleId }) {
  const [open, setOpen] = useState(false);
  const history = usePagedList((cursor) => (open ? repository.listProperties(vehicleId, cursor)
    : Promise.resolve({ data: [], page: null })), [vehicleId, open]);
  if (!open) return <Button variant="secondary" onPress={() => setOpen(true)}>Ver historial de propiedad</Button>;
  return <View style={styles.group}>
    {history.state === "loading" ? <Loading label="Cargando historial" /> : null}
    {history.state === "error" ? <><Notice value={history.error} /><Button variant="secondary" onPress={history.reload}>Reintentar historial</Button></> : null}
    {history.rows.map((row) => <View key={row.id} style={styles.card}>
      <Text style={styles.label}>{row.nombreCliente}{row.hastaEn ? "" : " · actual"}</Text>
      <Text style={styles.hint}>Desde {describeInstant(row.desdeEn)}{row.hastaEn ? ` hasta ${describeInstant(row.hastaEn)}` : ""}</Text>
      <Text style={styles.hint}>Motivo: {row.motivo}</Text>
    </View>)}
    {history.page?.hayMas ? <Button variant="secondary" onPress={history.more}>Cargar más períodos</Button> : null}
  </View>;
}

export function VehicleDetailScreen() {
  const { id } = useLocalSearchParams();
  const types = useVehicleTypes();
  const [vehicle, setVehicle] = useState(null);
  const [form, setForm] = useState(EMPTY_VEHICLE);
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
      const fresh = await repository.getVehicle(id);
      setVehicle(fresh); setForm(vehicleToForm(fresh)); setErrors({}); setState("ready");
    } catch (failure) { setLoadError(errorMessage(failure)); setState("error"); }
  }, [id]);
  useEffect(() => { void reload(); }, [reload]);
  const changes = vehicle ? vehicleChanges(vehicle, form) : {};
  const hasChanges = Object.keys(changes).length > 0;

  async function save() {
    const validation = validateVehicleForm(form);
    setErrors(validation); setDiscarded(null);
    if (Object.keys(validation).length) { setMessage({ text: "Revisa los campos marcados.", tone: "error" }); return; }
    setSaving(true); setMessage({ text: "", tone: "success" });
    try {
      const updated = await repository.updateVehicle(id, vehicle.version, changes);
      setVehicle(updated); setForm(vehicleToForm(updated));
      setMessage({ text: "Datos del vehículo guardados.", tone: "success" });
    } catch (failure) {
      if (failure.code === "VERSION_DESACTUALIZADA" || failure.uncertain) {
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
    Alert.alert("Desactivar vehículo", "No se podrán abrir nuevas órdenes con este vehículo. Su propiedad, historia, órdenes y QR se conservan.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Desactivar vehículo", style: "destructive", onPress: async () => {
        try {
          await command.run(`/interno/vehiculos/${id}/desactivar`, { versionEsperada: vehicle.version, motivo: reason.trim() });
          setReason(""); await reload(); setMessage({ text: "Vehículo desactivado.", tone: "success" });
        } catch (failure) {
          if (failure.code === "VERSION_DESACTUALIZADA" || failure.code === "ESTADO_INCOMPATIBLE") await reload();
          setMessage({ text: errorMessage(failure), tone: "error" });
        }
      } },
    ]);
  }

  const locked = saving || command.busy || command.pending || state !== "ready";
  return <ScreenContainer><View style={styles.stack}>
    {state === "loading" && !vehicle ? <Loading label="Cargando vehículo" /> : null}
    {state === "error" ? <><Notice value={loadError} /><Button variant="secondary" onPress={reload}>Reintentar</Button></> : null}
    {vehicle ? <>
      <Text accessibilityRole="header" style={styles.title}>{title(vehicle)}</Text>
      <KeyValue label="Tipo" value={vehicle.tipoVehiculo} />
      <KeyValue label="VIN" value={vehicle.vin} />
      <KeyValue label="Año" value={vehicle.anio == null ? null : String(vehicle.anio)} />
      <KeyValue label="Color" value={vehicle.color} />
      <KeyValue label="Estado" value={vehicle.activo ? "Activo" : "Inactivo"} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Abrir propietario ${vehicle.propiedadActual.nombreCliente}`}
        onPress={() => router.push(`/interno/gestion/clientes/${vehicle.propiedadActual.clienteId}`)} style={styles.selected}>
        <Text style={styles.hint}>Propietario actual</Text>
        <Text style={styles.label}>{vehicle.propiedadActual.nombreCliente}</Text>
        <Text style={styles.hint}>Desde {describeInstant(vehicle.propiedadActual.desdeEn)}</Text>
      </Pressable>
      <View style={styles.card}>
        <Text style={styles.label}>QR: {QR_STATES[vehicle.qr.estado] ?? "Estado no reconocido"}</Text>
        <Text style={styles.hint}>{vehicle.qr.generacionId ? `Generación ${vehicle.qr.generacionId} · emitido ${describeInstant(vehicle.qr.emitidoEn)}` : "Sin emisión"}</Text>
        <Text style={styles.hint}>El enlace del QR no se puede volver a consultar: solo se muestra al emitirse.</Text>
      </View>
      {vehicle.ordenActivaId
        ? <Button variant="secondary" onPress={() => router.push(`/interno/ordenes/${vehicle.ordenActivaId}`)}>{`Ver orden activa #${vehicle.ordenActivaId}`}</Button>
        : <Text style={styles.hint}>Sin orden activa.</Text>}
      <Notice value={message.text} tone={message.tone} />
      {discarded ? <Text style={styles.warning}>Tu borrador no guardado era: {Object.entries(discarded).map(([field, value]) => `${field}: ${value ?? "(vacío)"}`).join(" · ")}</Text> : null}

      <Text style={styles.section}>Propiedad</Text>
      <PropertyHistory vehicleId={id} />
      <Button variant="secondary" disabled={locked} onPress={() => router.push(`/interno/gestion/vehiculos/transferir/${id}`)}>Transferir propietario</Button>

      <Text style={styles.section}>Datos del vehículo</Text>
      <VehicleFields form={form} setForm={setForm} errors={errors} disabled={locked} types={types} />
      <Button disabled={locked || !hasChanges} onPress={save}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
      {!hasChanges ? <Text style={styles.hint}>Modifica algún dato para habilitar el guardado. Propietario y QR no se editan aquí.</Text> : null}

      {vehicle.activo ? <>
        <Text style={styles.section}>Desactivar</Text>
        <Field label="Motivo de desactivación" required multiline maxLength={500} value={reason} onChangeText={setReason} editable={!locked} />
        <Button variant="danger" disabled={locked} onPress={confirmDeactivation}>Desactivar vehículo</Button>
      </> : null}
      {command.pending ? <Button disabled={command.busy} onPress={confirmDeactivation}>Reintentar la misma desactivación</Button> : null}
      <Button variant="secondary" disabled={saving || command.busy} onPress={() => { setDiscarded(null); setMessage({ text: "", tone: "success" }); void reload(); }}>Recargar</Button>
    </> : null}
  </View></ScreenContainer>;
}

export function TransferScreen() {
  const { id } = useLocalSearchParams();
  const [vehicle, setVehicle] = useState(null);
  const [state, setState] = useState("loading");
  const [owner, setOwner] = useState(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const command = useCommandIntent();
  const reload = useCallback(async () => {
    setState("loading");
    try { setVehicle(await repository.getVehicle(id)); setState("ready"); }
    catch (failure) { setError(errorMessage(failure)); setState("error"); }
  }, [id]);
  useEffect(() => { void reload(); }, [reload]);
  const locked = command.busy || command.pending;

  function confirm() {
    if (!command.pending) {
      if (!owner) { setError("Selecciona al nuevo propietario."); return; }
      if (!reason.trim()) { setError("Indica el motivo de la transferencia."); return; }
    }
    setError("");
    Alert.alert("Transferir vehículo", `${vehicle.propiedadActual.nombreCliente} dejará de ser propietario y ${owner.nombre} será el nuevo propietario actual. El QR anterior dejará de funcionar y se emitirá uno nuevo. Las órdenes, pagos y deudas anteriores conservan su cliente.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Transferir vehículo", onPress: async () => {
        try {
          const data = await command.run(`/interno/vehiculos/${id}/transferir-propietario`, transferBody(vehicle, owner.id, reason));
          setResult({ ...data, ownerName: owner.nombre });
        } catch (failure) {
          if (failure.code === "PROPIEDAD_CAMBIADA") { setOwner(null); await reload(); }
          setError(errorMessage(failure));
        }
      } },
    ]);
  }

  if (result) {
    return <ScreenContainer><View style={styles.stack}>
      <Text accessibilityRole="header" style={styles.title}>Propietario transferido</Text>
      <Text style={styles.text}>{result.ownerName} es ahora el propietario actual. El QR anterior dejó de servir.</Text>
      <QrEmission emission={result.emisionQr} />
      <Button onPress={() => router.replace(`/interno/gestion/vehiculos/${id}`)}>Ver vehículo</Button>
    </View></ScreenContainer>;
  }
  return <ScreenContainer><View style={styles.stack}>
    {state === "loading" ? <Loading label="Cargando vehículo" /> : null}
    {state === "error" ? <Button variant="secondary" onPress={reload}>Reintentar</Button> : null}
    {vehicle ? <>
      <Text accessibilityRole="header" style={styles.title}>{title(vehicle)}</Text>
      <KeyValue label="Propietario actual" value={vehicle.propiedadActual.nombreCliente} />
      <OwnerPicker label="Nuevo propietario" owner={owner} onChange={setOwner} disabled={locked}
        excludeId={vehicle.propiedadActual.clienteId} />
      <Field label="Motivo de la transferencia" required multiline maxLength={1000} value={reason}
        onChangeText={setReason} editable={!locked} placeholder="Ej. Compraventa" />
      <Text style={styles.warning}>La transferencia revoca el QR actual y emite uno nuevo en la misma operación.</Text>
    </> : null}
    <Notice value={error} />
    {vehicle ? <Button disabled={command.busy} onPress={confirm}>
      {command.busy ? "Transfiriendo…" : command.pending ? "Reintentar la misma transferencia" : "Revisar y transferir"}</Button> : null}
  </View></ScreenContainer>;
}
