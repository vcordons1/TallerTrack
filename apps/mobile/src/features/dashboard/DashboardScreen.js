import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radii, spacing, typography } from "../../theme/tokens";
import {
  ActivityEmptyState,
  DashboardError,
  DashboardLoading,
  MetricCard,
  OrderStatusSummary,
  PeriodSelector,
  RecentActivityItem,
  SectionHeader,
  SummaryCard,
  SummaryRow,
} from "./DashboardComponents";

const {
  DASHBOARD_PERIODS,
} = require("./demoDashboardFixtures");
const {
  demoDashboardRepository,
} = require("./demoDashboardRepository");
const {
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

export function DashboardScreen({ repository = demoDashboardRepository }) {
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
    <SafeAreaView edges={["right", "bottom", "left"]} style={styles.safeArea}>
      {state.status === "loading" ? (
        <View style={styles.stateContent}>
          <DashboardLoading />
        </View>
      ) : null}
      {state.status === "error" ? (
        <View style={styles.stateContent}>
          <DashboardError message={state.message} onRetry={retry} />
        </View>
      ) : null}
      {state.status === "success" ? (
        <DashboardContent
          activity={state.data.activity}
          dashboard={state.data.dashboard}
          onPeriodChange={setPeriod}
          selectedPeriod={period}
        />
      ) : null}
    </SafeAreaView>
  );
}

function DashboardContent({ dashboard, activity, selectedPeriod, onPeriodChange }) {
  const activeTotal = getActiveOrdersTotal(dashboard.actual);
  const readyTotal = getReadyForDeliveryTotal(dashboard.actual);
  const waitingAuthorization = getOrderCount(
    dashboard.actual,
    "ESPERANDO_AUTORIZACION",
  );
  const orderItems = useMemo(
    () =>
      dashboard.actual.ordenesPorEstado.map((item) => ({
        ...item,
        label: ORDER_STATE_LABELS[item.estado] ?? item.estado,
      })),
    [dashboard.actual.ordenesPorEstado],
  );
  const maxOrderCount = Math.max(...orderItems.map(({ cantidad }) => cantidad), 0);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.heading}>
        <View style={styles.eyebrowRow}>
          <MaterialCommunityIcons
            accessible={false}
            color={colors.informational}
            name="view-dashboard-outline"
            size={16}
          />
          <Text style={styles.eyebrow}>Vista administrativa</Text>
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          Dashboard
        </Text>
        <Text style={styles.cutoff}>
          Corte: {formatCutoff(dashboard.corteEn, dashboard.zonaHoraria)}
        </Text>
      </View>

      <PeriodSelector
        onChange={onPeriodChange}
        options={PERIOD_OPTIONS}
        value={selectedPeriod}
      />

      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroLabel}>Órdenes activas</Text>
            <Text style={styles.heroValue}>{activeTotal}</Text>
          </View>
          <View style={styles.heroIcon}>
            <MaterialCommunityIcons
              accessible={false}
              color={colors.onPrimary}
              name="car-wrench"
              size={24}
            />
          </View>
        </View>
        <View style={styles.heroSignals}>
          <View style={styles.heroSignal}>
            <Text style={styles.heroSignalValue}>{waitingAuthorization}</Text>
            <Text style={styles.heroSignalLabel}>esperan autorización</Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroSignal}>
            <Text style={styles.heroSignalValue}>{readyTotal}</Text>
            <Text style={styles.heroSignalLabel}>para entregar</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader
          description="Situación actual, independiente del período seleccionado."
          title="Estado de órdenes"
        />
        <OrderStatusSummary items={orderItems} maxCount={maxOrderCount} />
        <View style={styles.metricsGrid}>
          <MetricCard
            icon="file-document-alert-outline"
            label="Propuestas pendientes"
            tone="warning"
            value={dashboard.actual.propuestasPendientes}
          />
          <MetricCard
            icon="source-branch-plus"
            label="Ampliaciones pendientes"
            tone="warning"
            value={dashboard.actual.ampliacionesPendientes}
          />
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Inventario" />
        <View style={styles.metricsGrid}>
          <MetricCard
            icon="package-variant-minus"
            label="Repuestos bajo mínimo"
            supporting="Disponibilidad actual"
            tone="danger"
            value={dashboard.actual.repuestosBajoMinimo}
          />
          <MetricCard
            icon="archive-check-outline"
            label="Reservas activas"
            supporting="Compromisos vigentes"
            tone="info"
            value={dashboard.actual.reservasActivas}
          />
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader
          description={selectedPeriod === DASHBOARD_PERIODS.TODAY ? "Movimientos de hoy" : "Movimientos del mes actual"}
          title="Resumen económico"
        />
        <SummaryCard emphasized>
          <Text style={styles.netLabel}>Cobrado neto del período</Text>
          <Text style={styles.netValue}>
            {formatMoney(dashboard.actividadPeriodo.cobradoNeto)}
          </Text>
          <View style={styles.netDetails}>
            <Text style={styles.netSupporting}>
              Bruto {formatMoney(dashboard.actividadPeriodo.cobradoBruto)}
            </Text>
            <Text style={styles.netSupporting}>
              Anulado {formatMoney(dashboard.actividadPeriodo.pagosAnulados)}
            </Text>
          </View>
        </SummaryCard>
        <SummaryCard>
          <SummaryRow
            first
            label="Saldo pendiente actual"
            tone="warning"
            value={formatMoney(dashboard.actual.saldoPendiente)}
          />
          <SummaryRow
            label="Saldo a favor"
            tone="success"
            value={formatMoney(dashboard.actual.saldoAFavor)}
          />
          <SummaryRow
            label="Clientes con deuda"
            tone="danger"
            value={dashboard.actual.clientesConDeuda}
          />
        </SummaryCard>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Actividad del período" />
        <View style={styles.metricsGrid}>
          <MetricCard
            icon="car-arrow-right"
            label="Entregas"
            tone="success"
            value={dashboard.actividadPeriodo.entregadas}
          />
          <MetricCard
            icon="car-off"
            label="Sin reparación"
            tone="neutral"
            value={dashboard.actividadPeriodo.entregadasSinReparacion}
          />
          <MetricCard
            icon="shield-check-outline"
            label="Garantías aceptadas"
            tone="success"
            value={dashboard.actividadPeriodo.garantiasAtendidasAceptadas}
          />
          <MetricCard
            icon="shield-remove-outline"
            label="Garantías rechazadas"
            tone="warning"
            value={dashboard.actividadPeriodo.garantiasAtendidasRechazadas}
          />
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Citas" />
        <View style={styles.metricsGrid}>
          <MetricCard
            icon="calendar-clock"
            label="Citas próximas"
            supporting={selectedPeriod === DASHBOARD_PERIODS.TODAY ? "Hasta el final del día" : "Hasta el final del mes"}
            tone="info"
            value={dashboard.citasProximas.cantidad}
          />
          <MetricCard
            icon="calendar-alert"
            label="Solicitudes pendientes"
            tone="warning"
            value={dashboard.solicitudesCitaPendientes}
          />
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader
          description="Hechos permitidos de órdenes, pagos, inventario y garantías."
          title="Actividad reciente"
        />
        {activity.length === 0 ? (
          <ActivityEmptyState />
        ) : (
          <SummaryCard>
            {activity.map((item, index) => (
              <RecentActivityItem
                formattedTime={formatActivityTime(
                  item.ocurridoEn,
                  dashboard.zonaHoraria,
                )}
                item={item}
                key={item.id}
                last={index === activity.length - 1}
                typeLabel={ACTIVITY_TYPE_LABELS[item.tipo] ?? item.tipo}
              />
            ))}
          </SummaryCard>
        )}
      </View>

      <Text style={styles.demoNotice}>
        Datos locales de demostración · Sin conexión al backend
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  stateContent: {
    flex: 1,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
  },
  content: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  heading: { gap: spacing.xs },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  eyebrow: { ...typography.label, color: colors.informational, textTransform: "uppercase" },
  title: { ...typography.display, color: colors.textPrimary },
  cutoff: { ...typography.supporting, color: colors.textSecondary, textTransform: "capitalize" },
  heroCard: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
  },
  heroTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  heroCopy: { gap: spacing.xs },
  heroLabel: { ...typography.label, color: colors.onPrimary },
  heroValue: { ...typography.display, color: colors.onPrimary, fontVariant: ["tabular-nums"] },
  heroIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.primaryPressed,
  },
  heroSignals: { flexDirection: "row", alignItems: "stretch" },
  heroSignal: { flex: 1, gap: spacing.xs },
  heroSignalValue: { ...typography.bodyStrong, color: colors.onPrimary, fontVariant: ["tabular-nums"] },
  heroSignalLabel: { ...typography.caption, color: colors.onPrimary },
  heroDivider: {
    width: 1,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.onPrimary,
    opacity: 0.36,
  },
  section: { gap: spacing.md },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  netLabel: { ...typography.label, color: colors.informational },
  netValue: {
    ...typography.display,
    marginTop: spacing.xs,
    color: colors.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  netDetails: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, marginTop: spacing.sm },
  netSupporting: { ...typography.caption, color: colors.textSecondary, fontVariant: ["tabular-nums"] },
  demoNotice: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
});
