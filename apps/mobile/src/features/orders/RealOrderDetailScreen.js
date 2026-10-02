import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { useSession } from "../../session/SessionProvider";
import { colors, radii, spacing, typography } from "../../theme/tokens";
import { realOrderRepository } from "./realOrderRepository";

const { formatDateTime, getOrderCode, ORDER_STATUS_PRESENTATION } = require("./orderPresentation");
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

function Line({ label, value }) {
  return <View style={styles.line}><Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value || "No disponible"}</Text></View>;
}

function Button({ label, onPress, disabled = false, selected = false }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled}
    onPress={onPress} style={[styles.button, disabled && styles.disabled, selected && styles.selected]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}

export function RealOrderDetailScreen() {
  const params = useLocalSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { access } = useSession();
  const reception = access.roles.includes("RECEPCIONISTA");
  const mechanic = access.roles.includes("MECANICO");
  // ADMINISTRADOR consults the reception projection (O03 A/R) without operational actions.
  const supervisor = !reception && !mechanic;
  const view = reception || supervisor ? "RECEPCION" : "TECNICA";
  const [state, setState] = useState({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [selectedMechanic, setSelectedMechanic] = useState(null);
  const [description, setDescription] = useState("");
  const [detail, setDetail] = useState("");
  const [summary, setSummary] = useState("");
  const [send, setSend] = useState({ status: "idle" });
  const flow = useRef(createFreeDiagnosticFlow({ uuid: Crypto.randomUUID })).current;

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    Promise.all([
      realOrderRepository.loadDetail(id, view),
      supervisor ? [] : allPages((cursor) => realOrderRepository.loadParticipants(id, cursor)),
      supervisor ? [] : allPages((cursor) => realOrderRepository.loadWorks(id, cursor)),
      supervisor ? [] : allPages((cursor) => realOrderRepository.loadDiagnoses(id, cursor)),
      reception ? allPages((cursor) => realOrderRepository.loadEligibleMechanics(id, cursor)) : [],
    ]).then(([order, participants, works, diagnoses, eligible]) => {
      if (active) setState({ status: "ready", order, participants, works, diagnoses, eligible });
    }, (error) => {
      if (active) setState({ status: "error", message: error.status === 404
        ? "La orden no existe o ya no está disponible."
        : "No se pudo consultar la orden. Comprueba la conexión." });
    });
    return () => { active = false; };
  }, [id, view, reception, supervisor, retry]);

  async function perform(kind, run) {
    if (send.status === "sending") return;
    setSend({ status: "sending" });
    try {
      await flow.run(kind, run);
      setSend({ status: "confirmed", message: "Cambio confirmado en el servidor." });
      setRetry((value) => value + 1);
    } catch (error) {
      setSend({ status: error.uncertain ? "uncertain" : "error",
        message: error.uncertain
          ? "No se confirmó el resultado. Verifica con la misma clave antes de otra acción."
          : error.message || "No se pudo completar la acción." });
    }
  }

  const busy = send.status === "sending" || send.status === "uncertain";
  const current = state.status === "ready" ? state.participants.filter((item) => item.retiradoEn === null) : [];
  const assigned = new Set(current.map((item) => item.mecanico.id));
  const proposed = state.status === "ready"
    ? state.works.find((item) => item.tipo === "DIAGNOSTICO" && item.diagnosticoGratuito && item.estado === "PROPUESTO") : null;
  const running = state.status === "ready"
    ? state.works.find((item) => item.tipo === "DIAGNOSTICO" && item.diagnosticoGratuito && item.estado === "EN_EJECUCION") : null;

  return <ScreenContainer fullSafeArea>
    <View style={styles.page}>
      <Pressable accessibilityRole="button" onPress={() => router.replace("/interno/ordenes")} style={styles.back}>
        <Text style={styles.backText}>← Órdenes</Text>
      </Pressable>
      {state.status === "loading" ? <ActivityIndicator color={colors.primary} /> : null}
      {state.status === "error" ? <><Text accessibilityRole="alert" style={styles.value}>{state.message}</Text>
        <Button label="Reintentar consulta" onPress={() => setRetry((value) => value + 1)} /></> : null}
      {state.status === "ready" ? <>
        <Text style={styles.eyebrow}>ORDEN CONFIRMADA EN SERVIDOR</Text>
        <Text accessibilityRole="header" style={styles.title}>{getOrderCode(state.order.id)}</Text>
        <Text style={styles.status}>{ORDER_STATUS_PRESENTATION[state.order.estado]?.label || state.order.estado}</Text>
        <View style={styles.section}>
          <Text style={styles.heading}>Vehículo y recepción</Text>
          <Line label="Vehículo" value={[state.order.vehiculo?.marca, state.order.vehiculo?.modelo, state.order.vehiculo?.anio].filter(Boolean).join(" ")} />
          <Line label="Placa" value={state.order.vehiculo?.placa || "Sin placa"} />
          {reception ? <Line label="Cliente contractual" value={state.order.clienteContractual?.nombre} /> : null}
          <Line label="Ingreso" value={formatDateTime(state.order.ingresadoEn)} />
          <Line label="Kilometraje" value={`${state.order.kilometrajeIngreso} km`} />
          <Line label="Propósito" value={state.order.proposito === "COMERCIAL" ? "Comercial" : "Garantía"} />
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>Registro de ingreso</Text>
          <Line label="Motivo" value={state.order.motivoIngreso} />
          <Line label="Daños visibles" value={state.order.danosVisibles} />
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>Mecánicos participantes</Text>
          {current.length === 0 ? <Text style={styles.muted}>No hay mecánicos asignados.</Text>
            : current.map((item) => <Line key={item.id} label={item.mecanico.nombre}
              value={`Asignado ${formatDateTime(item.asignadoEn)}`} />)}
          {state.participants.some((item) => item.retiradoEn !== null)
            ? <Text style={styles.muted}>Las participaciones retiradas permanecen en el historial.</Text> : null}
        </View>

        {reception && state.order.proposito === "COMERCIAL" && ["RECIBIDO", "EN_DIAGNOSTICO"].includes(state.order.estado)
          ? <View style={styles.section}>
            <Text style={styles.heading}>Asignar mecánico</Text>
            {state.eligible.filter((item) => !assigned.has(item.id)).length === 0
              ? <Text style={styles.muted}>No hay mecánicos elegibles sin asignar.</Text>
              : state.eligible.filter((item) => !assigned.has(item.id)).map((item) =>
                <Button key={item.id} label={item.nombre} selected={selectedMechanic === item.id}
                  disabled={busy} onPress={() => setSelectedMechanic(item.id)} />)}
            <Button label="Confirmar asignación" disabled={busy || !selectedMechanic || assigned.has(selectedMechanic)}
              onPress={() => perform("assign", (key) => realOrderRepository.assignMechanic(id, selectedMechanic, key))} />
          </View> : null}

        {mechanic && !reception ? <>
          <View style={styles.section}>
            <Text style={styles.heading}>Trabajo diagnóstico gratuito</Text>
            {state.works.length === 0 ? <Text style={styles.muted}>Todavía no hay trabajos en esta orden.</Text>
              : state.works.map((item) => <Line key={item.id} label={item.descripcion}
                value={`${item.estado}${item.diagnosticoGratuito ? " · Gratuito" : ""}`} />)}
            {state.order.proposito === "COMERCIAL" && ["RECIBIDO", "EN_DIAGNOSTICO"].includes(state.order.estado)
              ? <><TextInput accessibilityLabel="Descripción del diagnóstico" style={styles.input}
                value={description} onChangeText={setDescription} editable={!busy}
                placeholder="Qué se va a revisar" multiline />
                <Button label="Proponer diagnóstico gratuito" disabled={busy || !description.trim()}
                  onPress={() => perform("propose", (key) => realOrderRepository.proposeFreeDiagnosis(id, description.trim(), key))} />
                {proposed ? <Button label={`Iniciar ${proposed.descripcion}`} disabled={busy}
                  onPress={() => perform("start", (key) => realOrderRepository.startFreeDiagnosis(id, proposed.id, proposed.version, key))} /> : null}
              </> : null}
          </View>
          {running && state.order.estado === "EN_DIAGNOSTICO" ? <View style={styles.section}>
            <Text style={styles.heading}>Confirmar informe</Text>
            <TextInput accessibilityLabel="Detalle técnico" style={styles.input} value={detail}
              onChangeText={setDetail} editable={!busy} placeholder="Hallazgos técnicos" multiline />
            <TextInput accessibilityLabel="Resumen para cliente" style={styles.input} value={summary}
              onChangeText={setSummary} editable={!busy} placeholder="Resumen claro para cliente" multiline />
            <Button label="Confirmar diagnóstico" disabled={busy || !detail.trim() || !summary.trim()}
              onPress={() => perform("confirm", (key) => realOrderRepository.confirmDiagnosis(id, running.id,
                detail.trim(), summary.trim(), key))} />
          </View> : null}
        </> : null}

        <View style={styles.section}>
          <Text style={styles.heading}>Informes diagnósticos</Text>
          {state.diagnoses.length === 0 ? <Text style={styles.muted}>Todavía no hay informe confirmado.</Text>
            : state.diagnoses.map((item) => <View key={item.id} style={styles.line}>
              <Text style={styles.label}>Revisión {item.numeroRevision} · {formatDateTime(item.confirmadoEn)}</Text>
              <Text style={styles.value}>{item.resumenCliente}</Text>
              {!reception && item.detalleTecnico ? <Text style={styles.muted}>{item.detalleTecnico}</Text> : null}
            </View>)}
        </View>
      </> : null}
      {send.status === "sending" ? <ActivityIndicator color={colors.primary} /> : null}
      {["confirmed", "error", "uncertain"].includes(send.status)
        ? <Text accessibilityRole="alert" style={styles.value}>{send.message}</Text> : null}
      {send.status === "uncertain" ? <Button label="Verificar con la misma clave"
        onPress={() => perform(flow.pending.kind, flow.pending.action)} /> : null}
    </View>
  </ScreenContainer>;
}

const styles = StyleSheet.create({
  page: { gap: spacing.lg, paddingBottom: spacing.xxl },
  back: { minHeight: 48, justifyContent: "center" },
  backText: { ...typography.bodyStrong, color: colors.primary },
  eyebrow: { ...typography.caption, color: colors.primary, letterSpacing: 1 },
  title: { ...typography.display, color: colors.textPrimary },
  status: { ...typography.bodyStrong, color: colors.informational, backgroundColor: colors.informationalSurface,
    alignSelf: "flex-start", padding: spacing.md, borderRadius: radii.full },
  section: { backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radii.md, gap: spacing.md },
  heading: { ...typography.title2, color: colors.textPrimary },
  line: { borderTopWidth: 1, borderColor: colors.divider, paddingTop: spacing.sm, gap: spacing.xs },
  label: { ...typography.caption, color: colors.textSecondary },
  value: { ...typography.body, color: colors.textPrimary },
  muted: { ...typography.supporting, color: colors.textSecondary },
  input: { ...typography.body, color: colors.textPrimary, borderColor: colors.border,
    borderWidth: 1, borderRadius: radii.md, padding: spacing.md, minHeight: 64 },
  button: { minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: radii.md,
    backgroundColor: colors.primary, padding: spacing.md },
  selected: { backgroundColor: colors.informational },
  disabled: { opacity: 0.45 },
  buttonText: { ...typography.bodyStrong, color: colors.onPrimary },
});
