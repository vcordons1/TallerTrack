import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { colors, radii, spacing, typography } from "../../theme/tokens";
import { realOrderRepository } from "./realOrderRepository";

const { formatDateTime, getOrderCode, ORDER_STATUS_PRESENTATION } = require("./orderPresentation");

function Line({ label, value }) {
  return <View style={styles.line}><Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value || "No disponible"}</Text></View>;
}

export function RealOrderDetailScreen() {
  const params = useLocalSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [state, setState] = useState({ status: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    realOrderRepository.loadDetail(id, "RECEPCION").then(
      (order) => { if (active) setState({ status: "ready", order }); },
      (error) => { if (active) setState({ status: "error", message: error.status === 404
        ? "La orden no existe o ya no está disponible."
        : "No se pudo consultar la orden. Comprueba la conexión." }); },
    );
    return () => { active = false; };
  }, [id, retry]);

  return <ScreenContainer fullSafeArea>
    <View style={styles.page}>
      <Pressable accessibilityRole="button" onPress={() => router.replace("/interno/ordenes")} style={styles.back}>
        <Text style={styles.backText}>← Órdenes</Text>
      </Pressable>
      {state.status === "loading" ? <ActivityIndicator color={colors.primary} /> : null}
      {state.status === "error" ? <><Text accessibilityRole="alert" style={styles.value}>{state.message}</Text>
        <Pressable accessibilityRole="button" onPress={() => setRetry((n) => n + 1)} style={styles.back}><Text style={styles.backText}>Reintentar</Text></Pressable></> : null}
      {state.status === "ready" ? <>
        <Text style={styles.eyebrow}>ORDEN CONFIRMADA EN SERVIDOR</Text>
        <Text accessibilityRole="header" style={styles.title}>{getOrderCode(state.order.id)}</Text>
        <Text style={styles.status}>{ORDER_STATUS_PRESENTATION[state.order.estado]?.label || state.order.estado}</Text>
        <View style={styles.section}>
          <Text style={styles.heading}>Vehículo y recepción</Text>
          <Line label="Vehículo" value={[state.order.vehiculo?.marca, state.order.vehiculo?.modelo, state.order.vehiculo?.anio].filter(Boolean).join(" ")} />
          <Line label="Placa" value={state.order.vehiculo?.placa || "Sin placa"} />
          <Line label="Cliente contractual" value={state.order.clienteContractual?.nombre} />
          <Line label="Ingreso" value={formatDateTime(state.order.ingresadoEn)} />
          <Line label="Kilometraje" value={`${state.order.kilometrajeIngreso} km`} />
          <Line label="Propósito" value={state.order.proposito === "COMERCIAL" ? "Comercial" : "Garantía"} />
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>Registro de ingreso</Text>
          <Line label="Motivo" value={state.order.motivoIngreso} />
          <Line label="Daños visibles" value={state.order.danosVisibles} />
        </View>
      </> : null}
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
});
