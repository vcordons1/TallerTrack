import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import * as Crypto from "expo-crypto";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../../api/runtime";
import { useSession } from "../../session/SessionProvider";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ProductHeader } from "../../components/ProductHeader";
import { colors, radii, spacing, typography } from "../../theme/tokens";
const { INTERNAL_ROLES, validateUser, userError, createUserCommand } = require("./userFlow.cjs");

export function UserBoundary({ children }) {
  const { access } = useSession();
  if (access?.tipoActor !== "INTERNO" || !access.roles.includes("ADMINISTRADOR")) {
    return <ScreenContainer><Text style={styles.error}>No tienes permiso para administrar usuarios.</Text></ScreenContainer>;
  }
  return children;
}
export function UserButton({ children, onPress, disabled, danger = false }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.button, danger && styles.danger, disabled && styles.disabled, pressed && { opacity: 0.8 }]}>
    <Text style={styles.buttonText}>{children}</Text></Pressable>;
}
function Field({ label, ...props }) {
  return <View style={styles.group}><Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} style={styles.input} {...props} /></View>;
}
function Roles({ roles, onChange, disabled }) {
  return <View style={styles.group}><Text style={styles.label}>Roles internos</Text>{INTERNAL_ROLES.map((role) => {
    const selected = roles.includes(role);
    return <Pressable key={role} accessibilityRole="checkbox" accessibilityLabel={role}
      accessibilityState={{ checked: selected, disabled: !!disabled }} disabled={disabled}
      onPress={() => onChange(selected ? roles.filter((r) => r !== role) : [...roles, role])}
      style={[styles.role, selected && styles.selected]}>
      <Text style={styles.text}>{selected ? "✓  " : "○  "}{role}</Text></Pressable>;
  })}</View>;
}
function Notice({ value }) { return value ? <Text accessibilityRole="alert" style={styles.error}>{value}</Text> : null; }
function useCommand() {
  const command = useRef(null);
  command.current ||= createUserCommand({ request: api.request, uuid: Crypto.randomUUID });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  usePreventRemove(busy || command.current.pending, () => {
    Alert.alert("Operación pendiente", "Espera el resultado o reintenta la misma operación antes de salir.");
  });
  async function run(path, body, success) {
    if (busy) return;
    setBusy(true); setError("");
    try { const data = await command.current.run(path, body); await success(data); }
    catch (failure) { setError(userError(failure)); return failure; }
    finally { setBusy(false); }
  }
  return { busy, error, setError, run, pending: command.current.pending };
}

export function UserListScreen() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [active, setActive] = useState("");
  const [filters, setFilters] = useState({ q: "", active: "" });
  const [page, setPage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(async (cursor = null) => {
    const current = ++generation.current;
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ limite: "25" });
      if (filters.q) params.set("q", filters.q);
      if (filters.active) params.set("activo", filters.active);
      if (cursor) params.set("cursor", cursor);
      const result = await api.request(`/interno/usuarios?${params}`);
      if (generation.current !== current) return;
      setRows((previous) => cursor ? [...new Map([...previous, ...result.data].map((r) => [r.id, r])).values()] : result.data);
      setPage(result.page);
    } catch (failure) { if (generation.current === current) setError(userError(failure)); }
    finally { if (generation.current === current) setBusy(false); }
  }, [filters]);
  useFocusEffect(useCallback(() => { void load(); return () => { generation.current += 1; }; }, [load]));
  return <ScreenContainer fullSafeArea><View style={styles.stack}>
    <ProductHeader title="Usuarios internos" context="Administra el acceso del equipo" />
    <UserButton onPress={() => router.push("/interno/gestion/usuarios/nuevo")}>Crear usuario</UserButton>
    <Field label="Buscar por nombre o usuario" value={q} onChangeText={setQ} maxLength={100} autoCapitalize="none" />
    <View style={styles.group}>{[["", "Todos"], ["true", "Activos"], ["false", "Inactivos"]].map(([value, label]) =>
      <Pressable key={label} accessibilityRole="radio" accessibilityState={{ selected: active === value }}
        onPress={() => setActive(value)} style={[styles.role, active === value && styles.selected]}><Text style={styles.text}>{label}</Text></Pressable>)}</View>
    <UserButton disabled={busy} onPress={() => {
      if (q.trim().length === 1) { setError("Escribe al menos dos caracteres para buscar."); return; }
      setFilters({ q: q.trim(), active });
    }}>Buscar</UserButton>
    <Notice value={error} />
    {busy && <ActivityIndicator accessibilityLabel="Cargando usuarios" />}
    {!busy && !error && rows.length === 0 && <Text style={styles.text}>No hay usuarios para estos filtros.</Text>}
    {rows.map((user) => <Pressable accessibilityRole="button" accessibilityLabel={`Abrir ${user.nombreMostrado}`} key={user.id}
      onPress={() => router.push(`/interno/gestion/usuarios/${user.id}`)} style={styles.card}>
      <Text style={styles.label}>{user.nombreMostrado}</Text><Text style={styles.text}>{user.login}</Text>
      <Text style={styles.text}>{user.activo ? "Activo" : "Inactivo"} · {user.roles.join(" · ")}</Text></Pressable>)}
    <UserButton disabled={busy} onPress={() => load()}>Actualizar</UserButton>
    {page?.hayMas && <UserButton disabled={busy} onPress={() => load(page.siguienteCursor)}>Cargar más</UserButton>}
  </View></ScreenContainer>;
}

export function NewUserScreen() {
  const [name, setName] = useState(""); const [login, setLogin] = useState("");
  const [roles, setRoles] = useState([]); const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState(""); const [created, setCreated] = useState(null);
  const cmd = useCommand();
  const locked = cmd.busy || cmd.pending;
  async function submit() {
    const body = { nombreMostrado: name, login, roles, password };
    if (!cmd.pending) {
      const validation = validateUser(body);
      if (validation) { cmd.setError(validation); return; }
      if (password !== confirmation) { cmd.setError("Las contraseñas no coinciden."); return; }
    }
    await cmd.run("/interno/usuarios", body, (data) => { setPassword(""); setConfirmation(""); setCreated(data.usuarioId); });
  }
  return <ScreenContainer><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.stack}>
    {created ? <><Text accessibilityRole="header" style={styles.title}>Usuario creado</Text>
      <Text style={styles.text}>La cuenta ya puede iniciar sesión con su contraseña y los roles asignados.</Text>
      <UserButton onPress={() => router.replace(`/interno/gestion/usuarios/${created}`)}>Ver usuario</UserButton></> : <>
      <Field label="Nombre mostrado" value={name} onChangeText={setName} maxLength={200} editable={!locked} />
      <Field label="Usuario de acceso" value={login} onChangeText={setLogin} maxLength={150} autoCapitalize="none" autoCorrect={false} editable={!locked} />
      <Roles roles={roles} onChange={setRoles} disabled={locked} />
      <Text style={styles.text}>Alta presencial: verifica la identidad del empleado y deja que escriba su propia contraseña. No se mostrará después de crear la cuenta.</Text>
      <Field label="Contraseña elegida por el empleado" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={128} editable={!locked} />
      <Text style={styles.text}>Entre 12 y 128 caracteres. Puedes pegar desde un gestor de contraseñas.</Text>
      <Field label="Repetir contraseña" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" maxLength={128} editable={!locked} />
      <Notice value={cmd.error} />
      <UserButton disabled={cmd.busy} onPress={submit}>{cmd.busy ? "Creando…" : cmd.pending ? "Reintentar misma creación" : "Crear usuario"}</UserButton>
    </>}
  </KeyboardAvoidingView></ScreenContainer>;
}

export function UserDetailScreen() {
  const { id } = useLocalSearchParams(); const session = useSession();
  const [user, setUser] = useState(null); const [roles, setRoles] = useState([]); const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState("");
  const [review, setReview] = useState(false); const [success, setSuccess] = useState(""); const [kind, setKind] = useState(null);
  const cmd = useCommand(); const base = `/interno/usuarios/${id}`;
  const reload = useCallback(async () => {
    setLoading(true); setLoadError("");
    try { const r = await api.request(base); setUser(r.data); setRoles(r.data.roles); setReason(""); setReview(false); }
    catch (failure) { setLoadError(userError(failure)); }
    finally { setLoading(false); }
  }, [base]);
  useEffect(() => { void reload(); }, [reload]);
  async function execute(action) {
    setKind(action); setSuccess("");
    const body = { versionEsperada: user.version, motivo: reason, ...(action === "cambiar-roles" ? { roles } : {}) };
    const failure = await cmd.run(`${base}/${action}`, body, async () => {
      setSuccess(action === "desactivar" ? "Usuario desactivado. Su acceso fue revocado." : "Roles actualizados.");
      if (id === session.access.usuarioId) await session.refreshIdentity();
      else await reload();
    });
    if (failure?.code === "VERSION_DESACTUALIZADA" || failure?.code === "ESTADO_INCOMPATIBLE") setReview(true);
  }
  function confirm(action) {
    if (!reason.trim()) { cmd.setError("Ingresa el motivo de este cambio."); return; }
    if (action === "cambiar-roles" && !roles.length) { cmd.setError("Selecciona al menos un rol interno."); return; }
    Alert.alert(action === "desactivar" ? "Desactivar usuario" : "Cambiar roles", action === "desactivar"
      ? `${user.nombreMostrado} perderá el acceso y se cerrarán sus sesiones. Su historia se conserva.`
      : `${user.nombreMostrado} tendrá: ${roles.join(", ")}. Los permisos retirados dejarán de estar disponibles.`,
    [{ text: "Cancelar", style: "cancel" }, { text: "Confirmar", style: action === "desactivar" ? "destructive" : "default", onPress: () => execute(action) }]);
  }
  const locked = cmd.busy || cmd.pending || review || loading;
  return <ScreenContainer><View style={styles.stack}>
    {loading && <ActivityIndicator accessibilityLabel="Cargando usuario" />}<Notice value={loadError} />
    {!!success && <Text accessibilityLiveRegion="polite" style={styles.text}>{success}</Text>}
    {user && <><Text style={styles.title}>{user.nombreMostrado}</Text><Text style={styles.text}>{user.login} · {user.activo ? "Activo" : "Inactivo"}</Text>
      <Text style={styles.text}>Roles vigentes: {user.roles.join(", ")}</Text>
      {user.activo && <><Roles roles={roles} onChange={setRoles} disabled={locked} />
        <Field label="Motivo del cambio" value={reason} onChangeText={setReason} maxLength={500} multiline editable={!locked} />
        <UserButton disabled={locked} onPress={() => confirm("cambiar-roles")}>Guardar roles</UserButton>
        <UserButton danger disabled={locked} onPress={() => confirm("desactivar")}>Desactivar usuario</UserButton></>}
    </>}
    <Notice value={cmd.error} />
    {cmd.pending && <UserButton disabled={cmd.busy} onPress={() => execute(kind)}>Reintentar misma operación</UserButton>}
    <UserButton disabled={cmd.busy || cmd.pending} onPress={() => { cmd.setError(""); void reload(); }}>{review ? "Recargar y revisar" : "Actualizar detalle"}</UserButton>
  </View></ScreenContainer>;
}
const styles = StyleSheet.create({
  stack: { gap: spacing.lg }, group: { gap: spacing.sm },
  text: { ...typography.body, color: colors.textPrimary }, label: { ...typography.bodyStrong, color: colors.textPrimary },
  title: { ...typography.title1, color: colors.textPrimary }, error: { ...typography.body, color: colors.danger },
  input: { ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, padding: spacing.md },
  button: { minHeight: 48, padding: spacing.md, backgroundColor: colors.primary, borderRadius: radii.sm, alignItems: "center", justifyContent: "center" },
  buttonText: { ...typography.bodyStrong, color: colors.onPrimary }, danger: { backgroundColor: colors.danger }, disabled: { opacity: 0.5 },
  role: { minHeight: 48, padding: spacing.md, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  selected: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  card: { padding: spacing.lg, borderRadius: radii.md, backgroundColor: colors.surface, gap: spacing.xs },
});
