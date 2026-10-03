// TT-024 free-diagnostic UI (T01/T02/T04/D01/D02), rendered from TT-029.
// TECNICA readers (participating MECANICO) propose, start and report; RECEPCION readers
// (A/R) only read the confirmed reports with their server projection. Oracle decides every rule.
import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radii, spacing, typography } from "../../theme/tokens";
import { realOrderRepository } from "./realOrderRepository";

const { formatDateTime } = require("./orderPresentation");
const { createFreeDiagnosticFlow } = require("./freeDiagnosticFlow.cjs");
const { LIMITS, freeDiagnosticActions, freeDiagnosticMessage, loadMessage, needsReload } =
  require("./freeDiagnosticPresentation.cjs");

async function allPages(load) {
  let cursor = null;
  const data = [];
  do {
    const page = await load(cursor);
    data.push(...page.data);
    cursor = page.page?.siguienteCursor || null;
  } while (cursor);
  return data;
}

function Button({ label, onPress, disabled = false, secondary = false }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress}
    style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
  </Pressable>;
}

function Field({ label, value, onChange, editable, placeholder, max }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} style={styles.input} value={value} onChangeText={onChange}
      editable={editable} placeholder={placeholder} maxLength={max} multiline />
    <Text style={styles.counter}>{`${[...value].length}/${max}`}</Text>
  </View>;
}

const CONFIRMED = {
  propose: "Diagnóstico gratuito propuesto. Confirmado en el servidor.",
  start: "Diagnóstico iniciado: la orden pasó a «En diagnóstico».",
  confirm: "Informe de diagnóstico confirmado en el servidor.",
};
const WORK_STATE = { PROPUESTO: "Propuesto", EN_EJECUCION: "En ejecución", COMPLETADO: "Completado",
  CANCELADO: "Cancelado", DETENIDO: "Detenido" };

export function FreeDiagnosticSection({ orderId, order, technical, reloadKey = 0, onChanged }) {
  const [data, setData] = useState({ status: "loading", works: [], diagnoses: [] });
  const [reload, setReload] = useState(0);
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [summary, setSummary] = useState("");
  const [send, setSend] = useState({ status: "idle" });
  const flow = useRef(createFreeDiagnosticFlow({ uuid: Crypto.randomUUID })).current;

  useEffect(() => {
    let active = true;
    setData((current) => ({ ...current, status: current.status === "ready" ? "refreshing" : "loading" }));
    // R/A read only the reports; T01 is loaded for the technical reader that acts on works.
    Promise.all([
      technical ? allPages((cursor) => realOrderRepository.loadWorks(orderId, cursor)) : Promise.resolve([]),
      allPages((cursor) => realOrderRepository.loadDiagnoses(orderId, cursor)),
    ]).then(([works, diagnoses]) => {
      if (active) setData({ status: "ready", works, diagnoses });
    }, (error) => {
      if (active) setData((current) => ({ ...current, status: "error", message: loadMessage(error) }));
    });
    return () => { active = false; };
  }, [orderId, technical, reload, reloadKey]);

  async function perform(kind, run, clear) {
    if (send.status === "sending") return;
    setSend({ status: "sending", kind });
    try {
      await flow.run(kind, run);
      clear?.();
      setSend({ status: "confirmed", kind, message: CONFIRMED[kind] });
      setReload((value) => value + 1);
      onChanged?.();
    } catch (error) {
      setSend({ status: error.uncertain ? "uncertain" : "error", kind,
        message: error.code || error.status !== undefined || error.uncertain
          ? freeDiagnosticMessage(error, kind) : error.message });
      if (needsReload(error)) { setReload((value) => value + 1); onChanged?.(); }
    }
  }

  const sending = send.status === "sending";
  const busy = sending || send.status === "uncertain";
  const actions = freeDiagnosticActions({ order, works: data.works, diagnoses: data.diagnoses });
  const pendingKind = flow.pending?.kind;

  return <>
    {technical ? <View style={styles.section}>
      <Text style={styles.heading}>Trabajo diagnóstico gratuito</Text>
      {data.status === "loading" ? <ActivityIndicator color={colors.primary} /> : null}
      {data.status === "ready" || data.status === "refreshing" ? (data.works.length === 0
        ? <Text style={styles.muted}>Todavía no hay trabajos en esta orden.</Text>
        : data.works.map((item) => <View key={item.id} style={styles.line}>
          <Text style={styles.value}>{item.descripcion}</Text>
          <Text style={styles.muted}>{`${WORK_STATE[item.estado] || item.estado}${item.diagnosticoGratuito ? " · Gratuito" : ""} · versión ${item.version}`}</Text>
        </View>)) : null}
      {actions.canPropose ? <>
        <Field label="Descripción del diagnóstico" value={description} onChange={setDescription}
          editable={!busy} placeholder="Qué se va a revisar" max={LIMITS.descripcion} />
        <Button label={sending && send.kind === "propose" ? "Enviando…" : "Proponer diagnóstico gratuito"}
          disabled={busy || !description.trim()}
          onPress={() => perform("propose", (key) => realOrderRepository.proposeFreeDiagnosis(orderId,
            description.trim(), key), () => setDescription(""))} />
      </> : null}
      {actions.toStart ? <>
        <Field label="Motivo del inicio" value={reason} onChange={setReason}
          editable={!busy} placeholder="Por qué inicias el diagnóstico ahora" max={LIMITS.motivo} />
        <Button label={sending && send.kind === "start" ? "Enviando…" : "Iniciar diagnóstico"}
          disabled={busy || !reason.trim()}
          onPress={() => perform("start", (key) => realOrderRepository.startFreeDiagnosis(orderId,
            actions.toStart.id, actions.toStart.version, reason.trim(), key), () => setReason(""))} />
      </> : null}
      {actions.toConfirm ? <>
        <Field label="Detalle técnico" value={detail} onChange={setDetail}
          editable={!busy} placeholder="Hallazgos técnicos" max={LIMITS.detalleTecnico} />
        <Field label="Resumen para cliente" value={summary} onChange={setSummary}
          editable={!busy} placeholder="Resumen claro para el cliente" max={LIMITS.resumenCliente} />
        <Button label={sending && send.kind === "confirm" ? "Enviando…" : "Confirmar diagnóstico"}
          disabled={busy || !detail.trim() || !summary.trim()}
          onPress={() => perform("confirm", (key) => realOrderRepository.confirmDiagnosis(orderId,
            actions.toConfirm.id, detail.trim(), summary.trim(), key), () => { setDetail(""); setSummary(""); })} />
      </> : null}
    </View> : null}
    <View style={styles.section}>
      <Text style={styles.heading}>Informes diagnósticos</Text>
      {data.status === "loading" && !technical ? <ActivityIndicator color={colors.primary} /> : null}
      {data.status === "error" ? <>
        <Text accessibilityRole="alert" style={styles.value}>{data.message}</Text>
        <Button label="Reintentar trabajos y diagnósticos" secondary onPress={() => setReload((value) => value + 1)} />
      </> : null}
      {data.status === "ready" || data.status === "refreshing" ? (data.diagnoses.length === 0
        ? <Text style={styles.muted}>Todavía no hay informe confirmado.</Text>
        : data.diagnoses.map((item) => <View key={item.id} style={styles.line}>
          <Text style={styles.muted}>Revisión {item.numeroRevision} · {formatDateTime(item.confirmadoEn)}</Text>
          <Text style={styles.label}>Resumen para el cliente</Text>
          <Text style={styles.value}>{item.resumenCliente}</Text>
          {item.detalleTecnico ? <>
            <Text style={styles.label}>Detalle técnico</Text>
            <Text style={styles.value}>{item.detalleTecnico}</Text>
          </> : null}
        </View>)) : null}
    </View>
    {send.message ? <Text accessibilityRole="alert"
      style={[styles.message, send.status === "confirmed" ? styles.ok : styles.problem]}>{send.message}</Text> : null}
    {send.status === "uncertain" && pendingKind ? <Button label="Verificar este mismo envío"
      onPress={() => perform(pendingKind, flow.pending.action)} /> : null}
  </>;
}

const styles = StyleSheet.create({
  section: { backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radii.md, gap: spacing.md },
  heading: { ...typography.title2, color: colors.textPrimary },
  line: { borderTopWidth: 1, borderColor: colors.divider, paddingTop: spacing.sm, gap: spacing.xs },
  field: { gap: spacing.xs },
  label: { ...typography.caption, color: colors.textSecondary },
  value: { ...typography.body, color: colors.textPrimary },
  muted: { ...typography.supporting, color: colors.textSecondary },
  counter: { ...typography.caption, color: colors.textSecondary, alignSelf: "flex-end" },
  input: { ...typography.body, color: colors.textPrimary, borderColor: colors.border,
    borderWidth: 1, borderRadius: radii.md, padding: spacing.md, minHeight: 64 },
  button: { minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: radii.md,
    backgroundColor: colors.primary, padding: spacing.md },
  secondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.primary },
  disabled: { opacity: 0.45 },
  buttonText: { ...typography.bodyStrong, color: colors.onPrimary },
  secondaryText: { color: colors.primary },
  message: { ...typography.body, padding: spacing.md, borderRadius: radii.md },
  ok: { color: colors.textPrimary, backgroundColor: colors.informationalSurface },
  problem: { color: colors.textPrimary, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
