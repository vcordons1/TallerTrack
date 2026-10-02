import { useCallback, useEffect, useRef, useState } from "react";
import { usePreventRemove } from "expo-router/react-navigation";
import * as Crypto from "expo-crypto";
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";

import { api } from "../../api/runtime";
import { ScreenContainer } from "../../components/ScreenContainer";
import { useSession } from "../../session/SessionProvider";
import { colors, radii, spacing, typography } from "../../theme/tokens";
import { customerVehicleRepository } from "./customerVehicleRepository";

const { CAPABILITIES, hasInternalCapability } = require("../../navigation/accessPolicy");
const { createCommandIntent } = require("../../api/commandIntent.cjs");
const { customerVehicleMessage } = require("./customerVehicleForms.cjs");
const { formatDateTime } = require("../orders/orderPresentation");

export function CustomerVehicleBoundary({ children }) {
  const { access } = useSession();
  if (access?.tipoActor !== "INTERNO" || !hasInternalCapability(access.roles, CAPABILITIES.CUSTOMERS_VEHICLES)) {
    return <ScreenContainer><Text accessibilityRole="alert" style={styles.error}>No tienes permiso para gestionar clientes y vehículos.</Text></ScreenContainer>;
  }
  return children;
}

export function Button({ children, onPress, disabled = false, variant = "primary" }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, variant === "secondary" && styles.secondary, variant === "danger" && styles.danger,
      disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
    <Text style={[styles.buttonText, variant === "secondary" && styles.secondaryText]}>{children}</Text>
  </Pressable>;
}

export function Field({ label, required = false, hint, error, ...props }) {
  return <View style={styles.group}>
    <Text style={styles.label}>{label} <Text style={styles.hint}>{required ? "· Obligatorio" : "· Opcional"}</Text></Text>
    <TextInput accessibilityLabel={label} placeholderTextColor={colors.textSecondary}
      style={[styles.input, props.multiline && styles.multiline, error && styles.inputError]} {...props} />
    {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}

export function Notice({ value, tone = "error" }) {
  if (!value) return null;
  return <Text accessibilityRole={tone === "error" ? "alert" : undefined} accessibilityLiveRegion="polite"
    style={tone === "error" ? styles.error : styles.success}>{value}</Text>;
}

export function Choices({ label, options, value, onChange, disabled = false }) {
  return <View style={styles.group}>
    {label ? <Text style={styles.label}>{label}</Text> : null}
    <View style={styles.choices}>{options.map((option) => {
      const selected = option.value === value;
      return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
        accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => onChange(option.value)}
        style={[styles.choice, selected && styles.choiceSelected]}>
        <Text style={styles.text}>{option.label}</Text>
      </Pressable>;
    })}</View>
  </View>;
}

export function KeyValue({ label, value }) {
  return <View style={styles.keyValue}><Text style={styles.hint}>{label}</Text><Text selectable style={styles.text}>{value ?? "—"}</Text></View>;
}

export const QR_STATES = Object.freeze({ VIGENTE: "Vigente", REVOCADO: "Revocado", EXPIRADO: "Expirado", SIN_EMISION: "Sin emisión" });

export function describeInstant(value) {
  return value ? formatDateTime(value) : "—";
}

// The URL embeds the QR secret. It lives only in this screen's memory: never stored,
// logged or re-requested. Losing it requires an explicit future regeneration (Q02).
export function QrEmission({ emission }) {
  if (!emission) {
    return <Text style={styles.hint}>El enlace del QR solo se entrega en la primera confirmación. Esta respuesta fue una repetición: el QR sí existe, pero su enlace no puede recuperarse.</Text>;
  }
  return <View style={styles.card}>
    <Text style={styles.label}>QR emitido · generación {emission.generacionId}</Text>
    <Text selectable accessibilityLabel="Enlace público del QR" style={styles.text}>{emission.urlPublica}</Text>
    <Text style={styles.hint}>Emitido {describeInstant(emission.emitidoEn)}{emission.expiraEn ? ` · expira ${describeInstant(emission.expiraEn)}` : " · sin expiración"}.</Text>
    <Text style={styles.warning}>Este enlace se muestra solo ahora y no podrá consultarse después. Compártelo o imprímelo antes de salir.</Text>
    <Button variant="secondary" onPress={() => { void Share.share({ message: emission.urlPublica }).catch(() => {}); }}>Compartir enlace del QR</Button>
  </View>;
}

export function useCommandIntent() {
  const intent = useRef(null);
  intent.current ||= createCommandIntent({ request: api.request, uuid: Crypto.randomUUID });
  const [busy, setBusy] = useState(false);
  const [, rerender] = useState(0);
  usePreventRemove(busy || intent.current.pending, () => {
    Alert.alert("Operación pendiente", "Espera el resultado o reintenta la misma operación antes de salir.");
  });
  const run = useCallback(async (path, body) => {
    setBusy(true);
    try { return await intent.current.run(path, body); }
    finally { setBusy(false); rerender((value) => value + 1); }
  }, []);
  return { busy, run, get pending() { return intent.current.pending; } };
}

// Server-side search of active customers only: new relations never target inactive masters.
export function OwnerPicker({ owner, onChange, disabled = false, error, excludeId, label = "Propietario" }) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [state, setState] = useState("idle");
  const generation = useRef(0);
  useEffect(() => {
    if (owner || search.trim().length < 2) { setRows([]); setState("idle"); return undefined; }
    const current = ++generation.current;
    setState("loading");
    const timer = setTimeout(() => {
      customerVehicleRepository.listCustomers({ q: search.trim(), activo: "true" }).then(
        (result) => { if (current === generation.current) { setRows(result.data); setState("ready"); } },
        () => { if (current === generation.current) setState("error"); });
    }, 350);
    return () => clearTimeout(timer);
  }, [owner, search]);
  if (owner) {
    return <View style={styles.group}>
      <Text style={styles.label}>{label} <Text style={styles.hint}>· Obligatorio</Text></Text>
      <View style={styles.selected}>
        <Text style={styles.label}>{owner.nombre}</Text>
        <Text style={styles.hint}>{[owner.telefono, owner.email, owner.nit].filter(Boolean).join(" · ") || "Sin contacto registrado"}</Text>
        <Button variant="secondary" disabled={disabled} onPress={() => { setSearch(""); onChange(null); }}>Cambiar</Button>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>;
  }
  const visible = rows.filter((row) => row.id !== excludeId);
  return <View style={styles.group}>
    <Field label={`Buscar ${label.toLowerCase()}`} required value={search} onChangeText={setSearch} maxLength={100}
      editable={!disabled} placeholder="Nombre, teléfono, correo o NIT" error={error}
      hint={search.trim().length < 2 ? "Escribe al menos 2 caracteres. Solo aparecen clientes activos." : undefined} />
    {state === "loading" ? <ActivityIndicator accessibilityLabel="Buscando clientes" color={colors.primary} /> : null}
    {state === "error" ? <Text style={styles.error}>No se pudo buscar. Modifica la búsqueda para reintentar.</Text> : null}
    {state === "ready" && visible.length === 0 ? <Text style={styles.hint}>No hay clientes activos coincidentes.</Text> : null}
    {visible.map((row) => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`Seleccionar ${row.nombre}`}
      disabled={disabled} onPress={() => onChange(row)} style={styles.row}>
      <Text style={styles.label}>{row.nombre}</Text>
      <Text style={styles.hint}>{[row.telefono, row.email, row.nit].filter(Boolean).join(" · ") || "Sin contacto registrado"}</Text>
    </Pressable>)}
  </View>;
}

export function useVehicleTypes() {
  const [types, setTypes] = useState([]);
  const [state, setState] = useState("loading");
  const load = useCallback(async () => {
    setState("loading");
    try { setTypes(await customerVehicleRepository.listVehicleTypes()); setState("ready"); }
    catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { types, state, reload: load };
}

// Types come from V08: the app never hardcodes vehicle type codes.
export function TypePicker({ types, state, value, onChange, onRetry, disabled = false, error }) {
  if (state === "loading") return <ActivityIndicator accessibilityLabel="Cargando tipos de vehículo" color={colors.primary} />;
  if (state === "error") {
    return <View style={styles.group}><Text style={styles.error}>No se pudieron cargar los tipos de vehículo.</Text>
      <Button variant="secondary" onPress={onRetry}>Reintentar tipos</Button></View>;
  }
  return <View style={styles.group}>
    <Choices label="Tipo de vehículo · Obligatorio" disabled={disabled} value={value} onChange={onChange}
      options={types.map((type) => ({ value: type.codigo, label: type.nombre }))} />
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}

export function Loading({ label }) {
  return <ActivityIndicator accessibilityLabel={label} color={colors.primary} />;
}

export function errorMessage(error) {
  return customerVehicleMessage(error);
}

export const styles = StyleSheet.create({
  stack: { gap: spacing.lg, paddingBottom: spacing.xxxl },
  group: { gap: spacing.sm },
  section: { ...typography.title2, color: colors.textPrimary, marginTop: spacing.md },
  title: { ...typography.title1, color: colors.textPrimary },
  text: { ...typography.body, color: colors.textPrimary },
  label: { ...typography.bodyStrong, color: colors.textPrimary },
  hint: { ...typography.supporting, color: colors.textSecondary },
  error: { ...typography.supporting, color: colors.danger },
  success: { ...typography.supporting, color: colors.success },
  warning: { ...typography.supporting, color: colors.warning, backgroundColor: colors.warningSurface, padding: spacing.sm, borderRadius: radii.sm },
  input: { ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface, minHeight: 48,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, padding: spacing.md },
  inputError: { borderColor: colors.danger },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  button: { minHeight: 48, padding: spacing.md, backgroundColor: colors.primary, borderRadius: radii.sm,
    alignItems: "center", justifyContent: "center" },
  secondary: { backgroundColor: colors.primarySurface },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.82 },
  buttonText: { ...typography.bodyStrong, color: colors.onPrimary, textAlign: "center" },
  secondaryText: { color: colors.primary },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: "center", borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  choiceSelected: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  row: { minHeight: 64, padding: spacing.lg, gap: spacing.xs, borderRadius: radii.md, backgroundColor: colors.surface },
  card: { padding: spacing.lg, gap: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surface },
  selected: { padding: spacing.lg, gap: spacing.sm, borderRadius: radii.md, backgroundColor: colors.primarySurface },
  keyValue: { gap: 2 },
});
