import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProductHeader } from "../../components/ProductHeader";
import { colors, radii, spacing, typography } from "../../theme/tokens";
import {
  ActivityEmptyState,
  AttentionRow,
  DashboardError,
  DashboardLoading,
  MetricTile,
  OperationalTimelineItem,
  OrderStatusGrid,
  PeriodSelector,
  SectionHeader,
  SummarySurface,
} from "./DashboardComponents";

const { DASHBOARD_PERIODS } = require("./demoDashboardFixtures");
const { demoDashboardRepository } = require("./demoDashboardRepository");
const {
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_TYPE_LABELS,
  ORDER_STATE_LABELS,
  formatActivityTime,
  formatCutoff,
  formatMoney,
  getActiveOrdersTotal,
  getOrderCount,
  getReadyForDeliveryTotal,
} = require("./dashboardPresentation");

const PERIOD_OPTIONS = Object.freeze([
  Object.freeze({ value: DASHBOARD_PERIODS.TODAY, label: "Hoy" }),
  Object.freeze({ value: DASHBOARD_PERIODS.CURRENT_MONTH, label: "Mes actual" }),
]);

const ORDER_STATE_TONES = Object.freeze({
  RECIBIDO: "neutral",
  EN_DIAGNOSTICO: "info",
  ESPERANDO_AUTORIZACION: "warning",
  EN_REPARACION: "info",
  LISTO_PARA_ENTREGA: "success",
  PENDIENTE_ENTREGA_SIN_REPARACION: "warning",
});

export function DashboardScreen({ repository = demoDashboardRepository, userName }) {
  const [period, setPeriod] = useState(DASHBOARD_PERIODS.TODAY);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    repository.load(period).then(
      (data) => active && setState({ status: "success", data }),
      (error) =>
        active &&
        setState({
          status: "error",
          message: error?.message ?? "Ocurrió un error inesperado.",
        }),
    );

    return () => {
      active = false;
    };
  }, [period, reloadKey, repository]);

  const retry = useCallback(() => setReloadKey((value) => value + 1), []);

  return (
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
      {state.status === "loading" ? (
        <View style={styles.stateContent}><DashboardLoading /></View>
      ) : null}
      {state.status === "error" ? (
        <View style={styles.stateContent}><DashboardError message={state.message} onRetry={retry} /></View>
      ) : null}
      {state.status === "success" ? (
        <DashboardContent
          activity={state.data.activity}
          dashboard={state.data.dashboard}
          onPeriodChange={setPeriod}
          selectedPeriod={period}
          userName={userName}
        />
      ) : null}
    </SafeAreaView>
  );
}

function DashboardContent({ dashboard, activity, selectedPeriod, onPeriodChange, userName }) {
  const activeTotal = getActiveOrdersTotal(dashboard.actual);
  const readyTotal = getReadyForDeliveryTotal(dashboard.actual);
  const waitingAuthorization = getOrderCount(dashboard.actual, "ESPERANDO_AUTORIZACION");
  const guaranteesHandled =
    dashboard.actividadPeriodo.garantiasAtendidasAceptadas +
    dashboard.actividadPeriodo.garantiasAtendidasRechazadas;
  const orderItems = useMemo(
    () =>
      dashboard.actual.ordenesPorEstado.map((item) => ({
        ...item,
        label: ORDER_STATE_LABELS[item.estado] ?? item.estado,
        tone: ORDER_STATE_TONES[item.estado] ?? "neutral",
      })),
    [dashboard.actual.ordenesPorEstado],
  );
  const periodTitle = selectedPeriod === DASHBOARD_PERIODS.TODAY ? "Resumen de hoy" : "Resumen del mes";

  return (
    <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <ProductHeader
        context={`Corte operativo · ${formatCutoff(dashboard.corteEn, dashboard.zonaHoraria)}`}
        title={userName ? `Buen día, ${userName}` : "Estado del taller"}
      />

      <PeriodSelector onChange={onPeriodChange} options={PERIOD_OPTIONS} value={selectedPeriod} />

      <View
        accessible
        accessibilityLabel={`${activeTotal} órdenes activas. ${waitingAuthorization} esperan autorización. ${readyTotal} listas para entrega.`}
        style={styles.hero}
      >
        <View accessible={false} style={styles.heroShapeLarge} />
        <View accessible={false} style={styles.heroShapeSmall} />
        <View style={styles.heroHeadingRow}>
          <Text style={styles.heroEyebrow}>OPERACIÓN ACTUAL</Text>
          <MaterialCommunityIcons accessible={false} color={colors.onPrimary} name="pulse" size={24} />
        </View>
        <View style={styles.heroMetric}>
          <Text style={styles.heroValue}>{activeTotal}</Text>
          <Text style={styles.heroLabel}>Órdenes activas</Text>
        </View>
        <View style={styles.heroSignals}>
          <View style={styles.heroSignal}>
            <Text style={styles.heroSignalValue}>{waitingAuthorization}</Text>
            <Text style={styles.heroSignalLabel}>esperan autorización</Text>
          </View>
          <View style={styles.heroSignal}>
            <Text style={styles.heroSignalValue}>{readyTotal}</Text>
            <Text style={styles.heroSignalLabel}>listas para entrega</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Requiere atención" description="Señales actuales que conviene revisar primero." />
        <SummarySurface>
          <AttentionRow icon="file-check-outline" label="Autorizaciones pendientes" value={waitingAuthorization} />
          <AttentionRow icon="file-document-alert-outline" label="Propuestas pendientes" value={dashboard.actual.propuestasPendientes} />
          <AttentionRow icon="package-variant-minus" label="Repuestos bajo mínimo" tone="danger" value={dashboard.actual.repuestosBajoMinimo} />
          <AttentionRow icon="account-alert-outline" label="Clientes con deuda" tone="danger" value={dashboard.actual.clientesConDeuda} last />
        </SummarySurface>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Estado de órdenes" description="Distribución de las órdenes activas por estado." />
        <OrderStatusGrid items={orderItems} />
        <View
          accessible
          accessibilityLabel={`${dashboard.actual.ampliacionesPendientes} ampliaciones pendientes. ${dashboard.actual.reservasActivas} reservas activas.`}
          style={styles.currentSignals}
        >
          <View style={styles.currentSignal}>
            <MaterialCommunityIcons accessible={false} color={colors.warning} name="source-branch-plus" size={20} />
            <Text style={styles.currentSignalText}><Text style={styles.currentSignalValue}>{dashboard.actual.ampliacionesPendientes}</Text> ampliaciones pendientes</Text>
          </View>
          <View style={styles.currentSignal}>
            <MaterialCommunityIcons accessible={false} color={colors.informational} name="archive-check-outline" size={20} />
            <Text style={styles.currentSignalText}><Text style={styles.currentSignalValue}>{dashboard.actual.reservasActivas}</Text> reservas activas</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader title={periodTitle} description="Actividad del período; saldos e inventario permanecen actuales." />
        <SummarySurface>
          <View style={styles.netSummary}>
            <View style={styles.netIcon}>
              <MaterialCommunityIcons accessible={false} color={colors.primary} name="cash-multiple" size={24} />
            </View>
            <Text style={styles.netLabel}>Cobrado neto</Text>
            <Text style={styles.netValue}>{formatMoney(dashboard.actividadPeriodo.cobradoNeto)}</Text>
            <View style={styles.netDetails}>
              <Text style={styles.netSupporting}>Bruto {formatMoney(dashboard.actividadPeriodo.cobradoBruto)}</Text>
              <Text style={styles.netSupporting}>Anulado {formatMoney(dashboard.actividadPeriodo.pagosAnulados)}</Text>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.metricGrid}>
            <MetricTile icon="calendar-clock" label="Citas próximas" tone="info" value={dashboard.citasProximas.cantidad} />
            <MetricTile icon="calendar-alert" label="Solicitudes de cita" tone="warning" value={dashboard.solicitudesCitaPendientes} />
            <MetricTile icon="car-arrow-right" label="Entregas" supporting={`${dashboard.actividadPeriodo.entregadasSinReparacion} sin reparación`} tone="success" value={dashboard.actividadPeriodo.entregadas} />
            <MetricTile icon="shield-check-outline" label="Garantías atendidas" supporting={`${dashboard.actividadPeriodo.garantiasAtendidasAceptadas} aceptadas · ${dashboard.actividadPeriodo.garantiasAtendidasRechazadas} rechazadas`} tone="success" value={guaranteesHandled} />
          </View>
          <View style={styles.summaryDivider} />
          <Text style={styles.subsectionLabel}>SALDOS ACTUALES</Text>
          <View style={styles.metricGrid}>
            <MetricTile icon="alert-circle-outline" label="Saldo pendiente" tone="warning" value={formatMoney(dashboard.actual.saldoPendiente)} />
            <MetricTile icon="plus-circle-outline" label="Saldo a favor" tone="success" value={formatMoney(dashboard.actual.saldoAFavor)} />
          </View>
        </SummarySurface>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Actividad reciente" description="Últimos hechos relevantes del taller." />
        {activity.length === 0 ? (
          <ActivityEmptyState />
        ) : (
          <View style={styles.timeline}>
            {activity.map((item, index) => (
              <OperationalTimelineItem
                actionLabel={ACTIVITY_ACTION_LABELS[item.accion] ?? item.accion}
                formattedTime={formatActivityTime(item.ocurridoEn, dashboard.zonaHoraria)}
                item={item}
                key={item.id}
                last={index === activity.length - 1}
                typeLabel={ACTIVITY_TYPE_LABELS[item.tipo] ?? item.tipo}
              />
            ))}
          </View>
        )}
      </View>

      <Text style={styles.demoNotice}>Modo demostración</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  stateContent: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: spacing.lg },
  content: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  hero: {
    minHeight: 220,
    overflow: "hidden",
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
  },
  heroShapeLarge: { position: "absolute", width: 190, height: 190, right: -72, top: -80, borderRadius: radii.full, backgroundColor: colors.onPrimary, opacity: 0.08 },
  heroShapeSmall: { position: "absolute", width: 74, height: 74, right: 76, bottom: -34, borderRadius: radii.full, backgroundColor: colors.onPrimary, opacity: 0.07 },
  heroHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroEyebrow: { ...typography.caption, color: colors.onPrimary, fontWeight: "700", letterSpacing: 0.7, opacity: 0.86 },
  heroMetric: { gap: 0 },
  heroValue: { ...typography.hero, color: colors.onPrimary, fontVariant: ["tabular-nums"] },
  heroLabel: { ...typography.title2, color: colors.onPrimary },
  heroSignals: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: "auto" },
  heroSignal: { minWidth: 128, flex: 1, gap: 2, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.onPrimarySubtle },
  heroSignalValue: { ...typography.title2, color: colors.onPrimary, fontVariant: ["tabular-nums"] },
  heroSignalLabel: { ...typography.supporting, color: colors.onPrimary, opacity: 0.9 },
  section: { gap: spacing.md },
  currentSignals: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingTop: spacing.xs },
  currentSignal: { minWidth: 150, flexGrow: 1, flexBasis: "45%", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  currentSignalText: { ...typography.supporting, flex: 1, color: colors.textSecondary },
  currentSignalValue: { ...typography.bodyStrong, color: colors.textPrimary, fontVariant: ["tabular-nums"] },
  netSummary: { alignItems: "flex-start", paddingVertical: spacing.lg },
  netIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginBottom: spacing.md, borderRadius: radii.md, backgroundColor: colors.primarySurface },
  netLabel: { ...typography.label, color: colors.textSecondary },
  netValue: { ...typography.display, marginTop: spacing.xs, color: colors.textPrimary, fontVariant: ["tabular-nums"] },
  netDetails: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, marginTop: spacing.sm },
  netSupporting: { ...typography.caption, color: colors.textSecondary, fontVariant: ["tabular-nums"] },
  summaryDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.xl, rowGap: spacing.sm },
  subsectionLabel: { ...typography.caption, marginTop: spacing.lg, color: colors.textSecondary, fontWeight: "700", letterSpacing: 0.6 },
  timeline: { padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface },
  demoNotice: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
});
