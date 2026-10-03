// TT-024 free-diagnostic UI (T01/T02/T04/D01/D02), moved out of the order detail by TT-028.
// It is intentionally NOT rendered until TT-029 accepts trabajos + diagnóstico on a device:
// TT-028 stops with the order in RECIBIDO and must not offer technical actions.
import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radii, spacing, typography } from "../../theme/tokens";
import { realOrderRepository } from "./realOrderRepository";

const { formatDateTime } = require("./orderPresentation");
const { createFreeDiagnosticFlow } = require("./freeDiagnosticFlow.cjs");

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

function Button({ label, onPress, disabled = false }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[styles.button, disabled && styles.disabled]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}

export function FreeDiagnosticSection({ orderId, order, technical, onChanged }) {
  const [data, setData] = useState({ works: [], diagnoses: [] });
  const [reload, setReload] = useState(0);
  const [description, setDescription] = useState("");
  const [detail, setDetail] = useState("");
  const [summary, setSummary] = useState("");
  const [send, setSend] = useState({ status: "idle" });
  const flow = useRef(createFreeDiagnosticFlow({ uuid: Crypto.randomUUID })).current;

  useEffect(() => {
    let active = true;
    Promise.all([
      allPages((cursor) => realOrderRepository.loadWorks(orderId, cursor)),
      allPages((cursor) => realOrderRepository.loadDiagnoses(orderId, cursor)),
    ]).then(([works, diagnoses]) => { if (active) setData({ works, diagnoses }); }, () => {});
    return () => { active = false; };
  }, [orderId, reload]);

  async function perform(kind, run) {
    if (send.status === "sending") return;
    setSend({ status: "sending" });
    try {
      await flow.run(kind, run);
      setSend({ status: "confirmed", message: "Cambio confirmado en el servidor." });
      setReload((value) => value + 1);
      onChanged?.();
    } catch (error) {
      setSend({ status: error.uncertain ? "uncertain" : "error",
        message: error.uncertain
          ? "Resultado desconocido. Verifica con la misma clave antes de otra acción."
          : error.message || "No se pudo completar la acción." });
    }
  }

  const busy = send.status === "sending" || send.status === "uncertain";
  const editable = order.proposito === "COMERCIAL" && ["RECIBIDO", "EN_DIAGNOSTICO"].includes(order.estado);
  const proposed = data.works.find((item) => item.tipo === "DIAGNOSTICO" && item.diagnosticoGratuito && item.estado === "PROPUESTO");
  const running = data.works.find((item) => item.tipo === "DIAGNOSTICO" && item.diagnosticoGratuito && item.estado === "EN_EJECUCION");

  return <>
    {technical ? <View style={styles.section}>
      <Text style={styles.heading}>Trabajo diagnóstico gratuito</Text>
      {data.works.map((item) => <Text key={item.id} style={styles.value}>
        {`${item.descripcion} · ${item.estado}${item.diagnosticoGratuito ? " · Gratuito" : ""}`}</Text>)}
      {editable ? <>
        <TextInput accessibilityLabel="Descripción del diagnóstico" style={styles.input} value={description}
          onChangeText={setDescription} editable={!busy} placeholder="Qué se va a revisar" multiline />
        <Button label="Proponer diagnóstico gratuito" disabled={busy || !description.trim()}
          onPress={() => perform("propose", (key) => realOrderRepository.proposeFreeDiagnosis(orderId, description.trim(), key))} />
        {proposed ? <Button label={`Iniciar ${proposed.descripcion}`} disabled={busy}
          onPress={() => perform("start", (key) => realOrderRepository.startFreeDiagnosis(orderId, proposed.id, proposed.version, key))} /> : null}
      </> : null}
      {running && order.estado === "EN_DIAGNOSTICO" ? <>
        <TextInput accessibilityLabel="Detalle técnico" style={styles.input} value={detail}
          onChangeText={setDetail} editable={!busy} placeholder="Hallazgos técnicos" multiline />
        <TextInput accessibilityLabel="Resumen para cliente" style={styles.input} value={summary}
          onChangeText={setSummary} editable={!busy} placeholder="Resumen claro para cliente" multiline />
        <Button label="Confirmar diagnóstico" disabled={busy || !detail.trim() || !summary.trim()}
          onPress={() => perform("confirm", (key) => realOrderRepository.confirmDiagnosis(orderId, running.id,
            detail.trim(), summary.trim(), key))} />
      </> : null}
    </View> : null}
    <View style={styles.section}>
      <Text style={styles.heading}>Informes diagnósticos</Text>
      {data.diagnoses.length === 0 ? <Text style={styles.muted}>Todavía no hay informe confirmado.</Text>
        : data.diagnoses.map((item) => <View key={item.id}>
          <Text style={styles.muted}>Revisión {item.numeroRevision} · {formatDateTime(item.confirmadoEn)}</Text>
          <Text style={styles.value}>{item.resumenCliente}</Text>
          {technical && item.detalleTecnico ? <Text style={styles.muted}>{item.detalleTecnico}</Text> : null}
        </View>)}
    </View>
    {send.message ? <Text accessibilityRole="alert" style={styles.value}>{send.message}</Text> : null}
    {send.status === "uncertain" ? <Button label="Verificar con la misma clave"
      onPress={() => perform(flow.pending.kind, flow.pending.action)} /> : null}
  </>;
}

const styles = StyleSheet.create({
  section: { backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radii.md, gap: spacing.md },
  heading: { ...typography.title2, color: colors.textPrimary },
  value: { ...typography.body, color: colors.textPrimary },
  muted: { ...typography.supporting, color: colors.textSecondary },
  input: { ...typography.body, color: colors.textPrimary, borderColor: colors.border,
    borderWidth: 1, borderRadius: radii.md, padding: spacing.md, minHeight: 64 },
  button: { minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: radii.md,
    backgroundColor: colors.primary, padding: spacing.md },
  disabled: { opacity: 0.45 },
  buttonText: { ...typography.bodyStrong, color: colors.onPrimary },
});
