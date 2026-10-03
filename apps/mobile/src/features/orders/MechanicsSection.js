// Coordinar mecánicos (API contract §8.3): O05 participants, I15 search, O06 assign, O07 retire.
// The server is the authority: the eligible list is not pre-filtered by current
// participation, so a duplicate is answered by Oracle (REFERENCIA_DUPLICADA), not by the UI.
import * as Crypto from "expo-crypto";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { api } from "../../api/runtime";
import { colors, radii, spacing, typography } from "../../theme/tokens";
import { realOrderRepository } from "./realOrderRepository";

const { formatDateTime } = require("./orderPresentation");
const { MAX_REASON, createAssignmentFlow } = require("./assignmentFlow.cjs");
const { assignmentMessage } = require("./assignmentMessage.cjs");

function Button({ label, onPress, disabled = false, selected = false, secondary = false }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled, selected }}
    disabled={disabled} onPress={onPress}
    style={[styles.button, secondary && styles.secondary, selected && styles.selected, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, secondary && !selected && styles.secondaryText]}>{label}</Text>
  </Pressable>;
}

const CONFIRMED = { ASIGNAR: "Asignación confirmada en el servidor.", RETIRAR: "Retiro confirmado en el servidor." };
const VERIFY = { ASIGNAR: "Verificar esta misma asignación", RETIRAR: "Verificar este mismo retiro" };

export function MechanicsSection({ orderId, participants, canCoordinate, assignable, onChanged }) {
  const flow = useRef(createAssignmentFlow({ request: api.request, uuid: Crypto.randomUUID })).current;
  const [, setTick] = useState(0);
  const [mode, setMode] = useState(null); // null | "ASIGNAR" | { retire: participationId }
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ status: "idle", rows: [] });
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState(null);
  const refresh = () => setTick((value) => value + 1);
  const locked = flow.locked;
  const current = participants.filter((item) => item.retiradoEn === null);
  const retired = participants.filter((item) => item.retiradoEn !== null);
  const currentIds = new Set(current.map((item) => item.mecanico.id));

  async function runSearch() {
    setSearch({ status: "loading", rows: [] });
    try {
      const result = await realOrderRepository.searchEligibleMechanics(orderId, query, null);
      setSearch({ status: "ready", rows: result.data, more: Boolean(result.page?.siguienteCursor) });
    } catch (error) {
      setSearch({ status: "error", rows: [], message: error.status === 403
        ? "Tu acceso actual no permite consultar mecánicos para esta orden."
        : "No se pudo consultar el directorio. Vuelve a intentar." });
    }
  }

  async function submit(action) {
    setLocalError(null);
    try {
      const outcome = action();
      refresh();
      await outcome;
      setMode(null); setSelected(null); setReason(""); setSearch({ status: "idle", rows: [] });
    } catch (error) {
      // Server outcomes are rendered from the flow; only local validation is shown here.
      if (error.code === "VALIDACION_LOCAL") setLocalError(error.message);
    } finally {
      refresh();
      // Confirmed facts and server rejections both change what the list must show.
      if (["CONFIRMADO", "RECHAZADO", "SIN_VERIFICAR"].includes(flow.phase)) onChanged();
    }
  }

  function open(nextMode) {
    if (locked) return;
    flow.acknowledge();
    setLocalError(null); setReason(""); setSelected(null);
    setMode(nextMode);
    if (nextMode === "ASIGNAR") void runSearch();
  }

  const status = flow.phase;
  const outcome = status === "CONFIRMADO" ? CONFIRMED[flow.kind]
    : ["RECHAZADO", "DESCONOCIDO", "SIN_VERIFICAR"].includes(status) && flow.error
      ? assignmentMessage(flow.error, flow.kind) : null;

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Mecánicos</Text>
    {current.length === 0 ? <Text style={styles.muted}>Sin mecánicos asignados.</Text> : null}
    {current.map((item) => <View key={item.id} style={styles.row}>
      <Text style={styles.value}>{item.mecanico.nombre}</Text>
      <Text style={styles.muted}>Vigente · asignado {formatDateTime(item.asignadoEn)}</Text>
      {canCoordinate ? (mode?.retire === item.id ? <View style={styles.form}>
        <TextInput accessibilityLabel="Motivo del retiro" style={styles.input} value={reason} editable={!locked}
          maxLength={MAX_REASON} onChangeText={setReason} placeholder="Por qué deja de participar" multiline />
        <Button label="Confirmar retiro" disabled={locked || !reason.trim()}
          onPress={() => submit(() => flow.retire(orderId, item.id, reason))} />
        {!locked ? <Button label="Cancelar" secondary onPress={() => setMode(null)} /> : null}
      </View> : <Button label={`Retirar a ${item.mecanico.nombre}`} secondary disabled={locked}
        onPress={() => open({ retire: item.id })} />) : null}
    </View>)}
    {retired.length > 0 ? <Text style={styles.subheading}>Participaciones retiradas</Text> : null}
    {retired.map((item) => <View key={item.id} style={styles.row}>
      <Text style={styles.value}>{item.mecanico.nombre}</Text>
      <Text style={styles.muted}>Retirado {formatDateTime(item.retiradoEn)}{item.motivoRetiro ? ` · ${item.motivoRetiro}` : ""}</Text>
    </View>)}

    {canCoordinate && assignable && mode !== "ASIGNAR" && !mode?.retire
      ? <Button label="Asignar mecánico" disabled={locked} onPress={() => open("ASIGNAR")} /> : null}
    {canCoordinate && !assignable ? <Text style={styles.muted}>El estado actual de la orden no admite nuevas asignaciones.</Text> : null}
    {canCoordinate && mode === "ASIGNAR" ? <View style={styles.form}>
      <Text style={styles.subheading}>Asignar mecánico</Text>
      <TextInput accessibilityLabel="Buscar mecánico" style={styles.input} value={query} editable={!locked}
        onChangeText={setQuery} placeholder="Nombre del mecánico" onSubmitEditing={runSearch} />
      <Button label="Buscar" secondary disabled={locked || search.status === "loading"} onPress={runSearch} />
      {search.status === "loading" ? <ActivityIndicator color={colors.primary} /> : null}
      {search.status === "error" ? <Text accessibilityRole="alert" style={styles.value}>{search.message}</Text> : null}
      {search.status === "ready" && search.rows.length === 0
        ? <Text style={styles.muted}>No hay mecánicos activos que coincidan.</Text> : null}
      {search.rows.map((row) => <Button key={row.id} secondary selected={selected === row.id} disabled={locked}
        label={currentIds.has(row.id) ? `${row.nombre} · ya participa` : row.nombre}
        onPress={() => setSelected(row.id)} />)}
      {search.more ? <Text style={styles.muted}>Hay más resultados: refina la búsqueda.</Text> : null}
      <TextInput accessibilityLabel="Motivo de la asignación" style={styles.input} value={reason} editable={!locked}
        maxLength={MAX_REASON} onChangeText={setReason} placeholder="Para qué se asigna" multiline />
      <Button label="Confirmar asignación" disabled={locked || !selected || !reason.trim()}
        onPress={() => submit(() => flow.assign(orderId, selected, reason))} />
      {!locked ? <Button label="Cancelar" secondary onPress={() => setMode(null)} /> : null}
    </View> : null}

    {status === "ENVIANDO" ? <View style={styles.status}><ActivityIndicator color={colors.primary} />
      <Text style={styles.value}>{flow.kind === "RETIRAR" ? "Enviando retiro…" : "Enviando asignación…"}</Text></View> : null}
    {localError ? <Text accessibilityRole="alert" style={styles.value}>{localError}</Text> : null}
    {outcome ? <Text accessibilityRole="alert" style={styles.value}>{outcome}</Text> : null}
    {status === "DESCONOCIDO" ? <Button label={VERIFY[flow.kind]}
      onPress={() => submit(() => flow.verify())} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radii.md, gap: spacing.md },
  heading: { ...typography.title2, color: colors.textPrimary },
  subheading: { ...typography.bodyStrong, color: colors.textPrimary },
  row: { borderTopWidth: 1, borderColor: colors.divider, paddingTop: spacing.sm, gap: spacing.xs },
  form: { gap: spacing.sm },
  status: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  value: { ...typography.body, color: colors.textPrimary },
  muted: { ...typography.supporting, color: colors.textSecondary },
  input: { ...typography.body, color: colors.textPrimary, borderColor: colors.border,
    borderWidth: 1, borderRadius: radii.md, padding: spacing.md, minHeight: 48 },
  button: { minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: radii.md,
    backgroundColor: colors.primary, padding: spacing.md },
  secondary: { backgroundColor: colors.primarySurface },
  selected: { backgroundColor: colors.informational },
  disabled: { opacity: 0.45 },
  buttonText: { ...typography.bodyStrong, color: colors.onPrimary },
  secondaryText: { color: colors.primary },
});
