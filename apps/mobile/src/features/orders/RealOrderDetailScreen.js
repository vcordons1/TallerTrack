import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { useSession } from "../../session/SessionProvider";
import { colors, radii, spacing, typography } from "../../theme/tokens";
import { MechanicsSection } from "./MechanicsSection";
import { realOrderRepository } from "./realOrderRepository";

const { formatDateTime, getOrderCode, ORDER_STATUS_PRESENTATION } = require("./orderPresentation");

// O06/O07 only change participations of an operational commercial order (Oracle decides).
const ASSIGNABLE_STATES = ["RECIBIDO", "EN_DIAGNOSTICO"];

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

function Button({ label, onPress }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={styles.button}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}

// `view` fixes the projection when the route already chose it (Mis órdenes → TECNICA).
// Otherwise A/R read RECEPCION and a pure MECANICO reads TECNICA (API contract §4.4).
export function RealOrderDetailScreen({ view: requestedView, listRoute = "/interno/ordenes", listLabel = "Órdenes" }) {
  const params = useLocalSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { access } = useSession();
  const reception = access.roles.includes("RECEPCIONISTA");
  const view = requestedView
    ?? (reception || access.roles.includes("ADMINISTRADOR") ? "RECEPCION" : "TECNICA");
  const technical = view === "TECNICA";
  const [state, setState] = useState({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      realOrderRepository.loadDetail(id, view),
      allPages((cursor) => realOrderRepository.loadParticipants(id, cursor)),
    ]).then(([order, participants]) => {
      if (active) setState({ status: "ready", order, participants });
    }, (error) => {
      if (!active) return;
      // A technical reader that lost its participation or role cannot recover by retrying.
      if (technical && (error.status === 403 || error.status === 404)) {
        setState({ status: "blocked", message: "Ya no tienes acceso técnico a esta orden: tu participación fue retirada o tu rol cambió." });
      } else if (error.status === 404) {
        setState({ status: "blocked", message: "La orden no existe o ya no está disponible." });
      } else if (error.status === 403) {
        setState({ status: "blocked", message: "Tu acceso actual no permite consultar esta orden." });
      } else {
        setState((current) => current.status === "ready"
          ? { ...current, refreshError: "No se pudo actualizar. Se muestra la última lectura confirmada." }
          : { status: "error", message: "No se pudo consultar la orden. Comprueba la conexión." });
      }
    }).finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [id, view, technical, reload]);

  // Refreshing keeps the loaded screen mounted, so a pending assignment intent survives.
  const refresh = useCallback(() => { setRefreshing(true); setReload((value) => value + 1); }, []);
  const back = () => router.replace(listRoute);

  return <ScreenContainer fullSafeArea>
    <View style={styles.page}>
      <Pressable accessibilityRole="button" onPress={back} style={styles.back}>
        <Text style={styles.backText}>← {listLabel}</Text>
      </Pressable>
      {state.status === "loading" ? <ActivityIndicator color={colors.primary} /> : null}
      {state.status === "error" ? <><Text accessibilityRole="alert" style={styles.value}>{state.message}</Text>
        <Button label="Reintentar consulta" onPress={refresh} /></> : null}
      {state.status === "blocked" ? <><Text accessibilityRole="alert" style={styles.value}>{state.message}</Text>
        <Button label={`Volver a ${listLabel}`} onPress={back} /></> : null}
      {state.status === "ready" ? <>
        <Text style={styles.eyebrow}>{technical ? "VISTA TÉCNICA · CONFIRMADA EN SERVIDOR" : "ORDEN CONFIRMADA EN SERVIDOR"}</Text>
        <Text accessibilityRole="header" style={styles.title}>{getOrderCode(state.order.id)}</Text>
        <Text style={styles.status}>{ORDER_STATUS_PRESENTATION[state.order.estado]?.label || state.order.estado}</Text>
        <Pressable accessibilityRole="button" disabled={refreshing} onPress={refresh} style={styles.refresh}>
          <Text style={styles.backText}>{refreshing ? "Actualizando…" : "Actualizar"}</Text>
        </Pressable>
        {state.refreshError ? <Text accessibilityRole="alert" style={styles.muted}>{state.refreshError}</Text> : null}
        <View style={styles.section}>
          <Text style={styles.heading}>Vehículo y recepción</Text>
          <Line label="Vehículo" value={[state.order.vehiculo?.marca, state.order.vehiculo?.modelo, state.order.vehiculo?.anio].filter(Boolean).join(" ")} />
          <Line label="Placa" value={state.order.vehiculo?.placa || "Sin placa"} />
          {!technical && state.order.clienteContractual
            ? <Line label="Cliente contractual" value={state.order.clienteContractual.nombre} /> : null}
          <Line label="Ingreso" value={formatDateTime(state.order.ingresadoEn)} />
          <Line label="Kilometraje" value={`${state.order.kilometrajeIngreso} km`} />
          <Line label="Propósito" value={state.order.proposito === "COMERCIAL" ? "Comercial" : "Garantía"} />
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>Registro de ingreso</Text>
          <Line label="Motivo" value={state.order.motivoIngreso} />
          <Line label="Daños visibles" value={state.order.danosVisibles} />
        </View>
        <MechanicsSection orderId={id} participants={state.participants}
          canCoordinate={!technical && reception}
          assignable={state.order.proposito === "COMERCIAL" && ASSIGNABLE_STATES.includes(state.order.estado)}
          onChanged={refresh} />
      </> : null}
    </View>
  </ScreenContainer>;
}

const styles = StyleSheet.create({
  page: { gap: spacing.lg, paddingBottom: spacing.xxl },
  back: { minHeight: 48, justifyContent: "center" },
  refresh: { minHeight: 48, justifyContent: "center", alignSelf: "flex-start" },
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
  button: { minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: radii.md,
    backgroundColor: colors.primary, padding: spacing.md },
  buttonText: { ...typography.bodyStrong, color: colors.onPrimary },
});
