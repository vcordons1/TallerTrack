import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { colors, radii, spacing, typography } from "../../theme/tokens";
import { receptionRepository } from "./receptionRepository";

const { createReceptionFlow, assertCurrentVehicle } = require("./receptionFlow.cjs");
const { createReceptionPhoto } = require("./photoUpload.cjs");
const { receptionMessage } = require("./receptionMessage.cjs");

function Action({ label, onPress, secondary = false, disabled = false }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.action, secondary && styles.secondary,
      disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
    <Text style={[styles.actionText, secondary && styles.secondaryText]}>{label}</Text>
  </Pressable>;
}

export function ReceptionScreen() {
  const flow = useRef(createReceptionFlow({ repository: receptionRepository, uuid: Crypto.randomUUID })).current;
  const submitting = useRef(false);
  const customerGeneration = useRef(0);
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState([]);
  const [searchState, setSearchState] = useState("idle");
  const [customer, setCustomer] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [vehicleCursor, setVehicleCursor] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [vehiclePageError, setVehiclePageError] = useState(false);
  const [km, setKm] = useState("");
  const [reason, setReason] = useState("");
  const [damage, setDamage] = useState("");
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = flow.hasPending;

  useEffect(() => {
    if (customer || search.trim().length < 2) { setCustomers([]); setSearchState("idle"); return; }
    let active = true;
    setSearchState("loading");
    const timer = setTimeout(() => {
      receptionRepository.searchCustomers(search).then(
        (rows) => { if (active) { setCustomers(rows); setSearchState("ready"); } },
        () => { if (active) setSearchState("error"); },
      );
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [search, customer]);

  async function chooseCustomer(item) {
    if (flow.hasPending) return;
    const generation = ++customerGeneration.current;
    setCustomer(item); setVehicle(null); setVehicles([]); setVehicleCursor(null);
    setPhoto(null); setError(""); flow.reset();
    setLoadingVehicles(true);
    try {
      const page = await receptionRepository.listVehicles(item.id);
      if (generation !== customerGeneration.current) return;
      setVehicles(page.vehicles); setVehicleCursor(page.cursor);
    }
    catch { if (generation === customerGeneration.current) setError("No se pudieron cargar los vehículos. Vuelve a seleccionar el cliente."); }
    finally { if (generation === customerGeneration.current) setLoadingVehicles(false); }
  }

  async function moreVehicles() {
    if (!vehicleCursor || loadingVehicles) return;
    const generation = customerGeneration.current;
    setLoadingVehicles(true); setVehiclePageError(false);
    try {
      const page = await receptionRepository.listVehicles(customer.id, vehicleCursor);
      if (generation !== customerGeneration.current) return;
      setVehicles((current) => [...current, ...page.vehicles]);
      setVehicleCursor(page.cursor);
    } catch { if (generation === customerGeneration.current) setVehiclePageError(true); }
    finally { if (generation === customerGeneration.current) setLoadingVehicles(false); }
  }

  async function chooseVehicle(item) {
    if (flow.hasPending) return;
    const generation = customerGeneration.current;
    setError("");
    try {
      const current = await receptionRepository.getVehicle(item.id);
      if (generation !== customerGeneration.current) return;
      assertCurrentVehicle(current, customer.id);
      setVehicle(current);
      setPhoto(null); flow.reset();
    } catch (failure) { if (generation === customerGeneration.current) setError(failure.message || "No se pudo verificar el vehículo."); }
  }

  async function choosePhoto(source) {
    if (flow.hasPending) return;
    setError("");
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { setError("Permite usar la cámara para tomar la evidencia de recepción."); return; }
      }
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (!result.canceled && result.assets?.[0]?.uri) {
        const asset = result.assets[0];
        setPhoto(createReceptionPhoto(asset));
        flow.reset();
      }
    } catch (failure) { setError(failure.code === "PHOTO_FORMAT_UNSUPPORTED"
      ? failure.message : "No se pudo preparar la fotografía. Intenta de nuevo."); }
  }

  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError("");
    try {
      const order = await flow.submit({ customerId: customer.id, vehicleId: vehicle.id,
        kilometrajeIngreso: km, motivoIngreso: reason, danosVisibles: damage, photo });
      if (order) router.replace({ pathname: "/interno/ordenes/[id]", params: { id: order.id } });
    } catch (failure) {
      if (failure.code === "PROPIEDAD_CAMBIADA") {
        setVehicle(null); setPhoto(null); flow.reset();
      }
      setError(flow.hasPending
        ? "El resultado aún no está verificado. Pulsa verificar para consultar o reintentar esta misma orden."
        : receptionMessage(failure));
    } finally { submitting.current = false; setBusy(false); }
  }

  return <ScreenContainer fullSafeArea>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.page}>
      <Text style={styles.eyebrow}>RECEPCIÓN / COMERCIAL</Text>
      <Text accessibilityRole="header" style={styles.title}>Nueva recepción</Text>
      <Text style={styles.supporting}>Selecciona al cliente y su vehículo vigente. La orden se confirma en el servidor.</Text>

      <Text style={styles.section}>1 · Cliente</Text>
      {customer ? <View style={styles.selected}><Text style={styles.strong}>{customer.nombre}</Text>
        <Action secondary disabled={locked} label="Cambiar cliente" onPress={() => { customerGeneration.current += 1; setCustomer(null); setVehicle(null); setPhoto(null); flow.reset(); }} />
      </View> : <>
        <TextInput accessibilityLabel="Buscar cliente" placeholder="Nombre, teléfono, correo o NIT"
          placeholderTextColor={colors.textSecondary} value={search} onChangeText={setSearch} style={styles.input} />
        {search.trim().length < 2 ? <Text style={styles.supporting}>Escribe al menos 2 caracteres.</Text> : null}
        {searchState === "loading" ? <ActivityIndicator color={colors.primary} /> : null}
        {searchState === "error" ? <Text style={styles.error}>No se pudo buscar. Modifica la búsqueda para reintentar.</Text> : null}
        {searchState === "ready" && customers.length === 0 ? <Text style={styles.supporting}>No hay clientes coincidentes.</Text> : null}
        {customers.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => chooseCustomer(item)} style={styles.row}>
          <Text style={styles.strong}>{item.nombre}</Text>
          <Text style={styles.supporting}>{[item.telefono, item.email].filter(Boolean).join(" · ")}</Text>
        </Pressable>)}
      </>}

      {customer ? <><Text style={styles.section}>2 · Vehículo actual</Text>
        {loadingVehicles ? <ActivityIndicator color={colors.primary} /> : null}
        {!loadingVehicles && vehicles.length === 0 ? <Text style={styles.supporting}>Este cliente no tiene vehículos actuales disponibles.</Text> : null}
        {!vehicle && vehicles.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => chooseVehicle(item)} style={styles.row}>
          <Text style={styles.strong}>{item.placa || "Sin placa"} · {item.marca} {item.modelo}</Text>
          <Text style={styles.supporting}>{item.tipoVehiculo}{item.anio ? ` · ${item.anio}` : ""}</Text>
        </Pressable>)}
        {!vehicle && vehicleCursor ? <Action secondary disabled={loadingVehicles}
          label={vehiclePageError ? "Error al cargar. Reintentar" : "Cargar más vehículos"} onPress={moreVehicles} /> : null}
        {vehicle ? <View style={styles.selected}><Text style={styles.strong}>{vehicle.placa || "Sin placa"} · {vehicle.marca} {vehicle.modelo}</Text>
          <Action secondary disabled={locked} label="Cambiar vehículo" onPress={() => { setVehicle(null); setPhoto(null); flow.reset(); }} /></View> : null}
      </> : null}

      {vehicle ? <><Text style={styles.section}>3 · Ingreso</Text>
        <Text style={styles.label}>Kilometraje de ingreso</Text>
        <TextInput accessibilityLabel="Kilometraje de ingreso" keyboardType="decimal-pad" value={km}
          onChangeText={setKm} editable={!locked} style={styles.input} placeholder="Ej. 321.0" />
        <Text style={styles.label}>Motivo de ingreso</Text>
        <TextInput accessibilityLabel="Motivo de ingreso" multiline editable={!locked} value={reason} onChangeText={setReason}
          style={[styles.input, styles.multiline]} maxLength={2000} />
        <Text style={styles.label}>Daños visibles</Text>
        <TextInput accessibilityLabel="Daños visibles" multiline editable={!locked} value={damage} onChangeText={setDamage}
          style={[styles.input, styles.multiline]} maxLength={2000} placeholder="Escribe 'Sin daños visibles' cuando corresponda" />
        <Text style={styles.section}>4 · Fotografía de recepción</Text>
        <Text style={styles.supporting}>Evidencia privada del estado del vehículo al ingresar.</Text>
        {photo ? <Image accessibilityLabel="Vista previa de la fotografía de recepción" source={{ uri: photo.uri }} style={styles.preview} /> : null}
        <Action secondary disabled={locked} label={photo ? "Reemplazar con cámara" : "Tomar fotografía"} onPress={() => choosePhoto("camera")} />
        <Action secondary disabled={locked} label="Seleccionar de galería" onPress={() => choosePhoto("gallery")} />
        {photo ? <Action secondary disabled={locked} label="Eliminar fotografía" onPress={() => { setPhoto(null); flow.reset(); }} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Action label={busy ? "Creando orden…" : flow.hasPending ? "Verificar o reintentar orden" : "Crear orden"}
          disabled={busy} onPress={submit} />
      </> : error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </KeyboardAvoidingView>
  </ScreenContainer>;
}

const styles = StyleSheet.create({
  page: { gap: spacing.md, paddingBottom: spacing.xxxl },
  eyebrow: { ...typography.caption, color: colors.primary, letterSpacing: 1 },
  title: { ...typography.title1, color: colors.textPrimary },
  section: { ...typography.title2, color: colors.textPrimary, marginTop: spacing.lg },
  supporting: { ...typography.supporting, color: colors.textSecondary },
  strong: { ...typography.bodyStrong, color: colors.textPrimary },
  label: { ...typography.label, color: colors.textPrimary },
  input: { minHeight: 52, padding: spacing.md, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, backgroundColor: colors.surface, ...typography.body, color: colors.textPrimary },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  row: { minHeight: 64, padding: spacing.lg, gap: spacing.xs, borderBottomWidth: 1, borderColor: colors.divider,
    backgroundColor: colors.surface },
  selected: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.primarySurface, borderRadius: radii.md },
  preview: { width: "100%", height: 180, borderRadius: radii.md, resizeMode: "cover" },
  action: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radii.md,
    backgroundColor: colors.primary, paddingHorizontal: spacing.md },
  secondary: { backgroundColor: colors.primarySurface },
  pressed: { opacity: 0.82 },
  disabled: { backgroundColor: colors.disabledSurface },
  actionText: { ...typography.bodyStrong, color: colors.onPrimary, textAlign: "center" },
  secondaryText: { color: colors.primary },
  error: { ...typography.supporting, color: colors.danger, paddingVertical: spacing.sm },
});
