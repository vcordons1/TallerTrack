import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, typography } from "../../theme/tokens";

const TONES = Object.freeze({
  neutral: {
    foreground: colors.textPrimary,
    surface: colors.surface,
  },
  info: {
    foreground: colors.informational,
    surface: colors.informationalSurface,
  },
  success: {
    foreground: colors.success,
    surface: colors.successSurface,
  },
  warning: {
    foreground: colors.warning,
    surface: colors.warningSurface,
  },
  danger: {
    foreground: colors.danger,
    surface: colors.dangerSurface,
  },
});

const ACTIVITY_ICONS = Object.freeze({
  ORDEN: "clipboard-text-outline",
  PAGO: "cash-check",
  INVENTARIO: "package-variant-closed-check",
  GARANTIA: "shield-check-outline",
});

export function SectionHeader({ title, description }) {
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {description ? (
        <Text style={styles.sectionDescription}>{description}</Text>
      ) : null}
    </View>
  );
}

export function PeriodSelector({ value, onChange, options }) {
  return (
    <View
      accessibilityLabel="Período del Dashboard"
      accessibilityRole="tablist"
      style={styles.segmentedControl}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityLabel={`Mostrar período: ${option.label}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.segmentSelected,
              pressed && styles.segmentPressed,
            ]}
          >
            <Text
              style={[
                styles.segmentLabel,
                selected && styles.segmentLabelSelected,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MetricCard({ icon, label, value, supporting, tone = "neutral" }) {
  const palette = TONES[tone];
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${supporting ? `. ${supporting}` : ""}`}
      style={[styles.metricCard, { backgroundColor: palette.surface }]}
    >
      <MaterialCommunityIcons
        accessible={false}
        color={palette.foreground}
        name={icon}
        size={20}
      />
      <Text style={[styles.metricValue, { color: palette.foreground }]}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
      {supporting ? <Text style={styles.metricSupporting}>{supporting}</Text> : null}
    </View>
  );
}

export function OrderStatusSummary({ items, maxCount }) {
  return (
    <View style={styles.card}>
      {items.map((item, index) => {
        const progress = maxCount > 0 ? item.cantidad / maxCount : 0;
        return (
          <View key={item.estado} style={index > 0 ? styles.dividedRow : null}>
            <View
              accessible
              accessibilityLabel={`${item.label}: ${item.cantidad}`}
              style={styles.orderRow}
            >
              <Text style={styles.orderLabel}>{item.label}</Text>
              <Text style={styles.orderCount}>{item.cantidad}</Text>
            </View>
            <View accessible={false} style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.max(progress * 100, item.cantidad > 0 ? 8 : 0)}%` },
                ]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function SummaryCard({ children, emphasized = false }) {
  return (
    <View style={[styles.card, emphasized && styles.cardEmphasized]}>
      {children}
    </View>
  );
}

export function SummaryRow({ label, value, tone = "neutral", first = false }) {
  const palette = TONES[tone];
  return (
    <View style={[styles.summaryRow, !first && styles.summaryRowDivided]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, { color: palette.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

export function RecentActivityItem({ item, typeLabel, formattedTime, last }) {
  return (
    <View style={[styles.activityItem, !last && styles.activityItemDivided]}>
      <View style={styles.activityIcon}>
        <MaterialCommunityIcons
          accessible={false}
          color={colors.informational}
          name={ACTIVITY_ICONS[item.tipo]}
          size={20}
        />
      </View>
      <View style={styles.activityContent}>
        <View style={styles.activityMetaRow}>
          <Text style={styles.activityType}>{typeLabel}</Text>
          <Text style={styles.activityTime}>{formattedTime}</Text>
        </View>
        <Text style={styles.activitySummary}>{item.resumen}</Text>
        {item.actor ? (
          <Text style={styles.activityActor}>Por {item.actor.nombre}</Text>
        ) : null}
      </View>
    </View>
  );
}

export function DashboardLoading() {
  return (
    <View
      accessibilityLabel="Cargando Dashboard"
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={styles.stateContainer}
    >
      <View style={[styles.skeleton, styles.skeletonHeading]} />
      <View style={[styles.skeleton, styles.skeletonSegment]} />
      <View style={[styles.skeleton, styles.skeletonHero]} />
      <View style={styles.skeletonGrid}>
        <View style={[styles.skeleton, styles.skeletonMetric]} />
        <View style={[styles.skeleton, styles.skeletonMetric]} />
      </View>
      <Text style={styles.stateSupporting}>Preparando el corte operativo…</Text>
    </View>
  );
}

export function DashboardError({ message, onRetry }) {
  return (
    <View accessibilityLiveRegion="assertive" style={styles.stateContainer}>
      <View style={styles.errorIcon}>
        <MaterialCommunityIcons
          accessible={false}
          color={colors.danger}
          name="alert-circle-outline"
          size={24}
        />
      </View>
      <Text accessibilityRole="header" style={styles.stateTitle}>
        No pudimos cargar el Dashboard
      </Text>
      <Text style={styles.stateSupporting}>{message}</Text>
      <Pressable
        accessibilityLabel="Reintentar carga del Dashboard"
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [
          styles.retryButton,
          pressed && styles.retryButtonPressed,
        ]}
      >
        <MaterialCommunityIcons
          accessible={false}
          color={colors.onPrimary}
          name="refresh"
          size={20}
        />
        <Text style={styles.retryLabel}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

export function ActivityEmptyState() {
  return (
    <View accessible style={styles.emptyState}>
      <MaterialCommunityIcons
        accessible={false}
        color={colors.textSecondary}
        name="timeline-clock-outline"
        size={24}
      />
      <Text style={styles.emptyTitle}>Sin actividad en este período</Text>
      <Text style={styles.emptySupporting}>
        No se registraron hechos recientes para el rango seleccionado.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { gap: spacing.xs },
  sectionTitle: { ...typography.title2, color: colors.textPrimary },
  sectionDescription: { ...typography.supporting, color: colors.textSecondary },
  segmentedControl: {
    flexDirection: "row",
    padding: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  segment: {
    minHeight: 48,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
  },
  segmentSelected: { backgroundColor: colors.primary },
  segmentPressed: { opacity: 0.78 },
  segmentLabel: { ...typography.label, color: colors.textSecondary },
  segmentLabelSelected: { color: colors.onPrimary },
  metricCard: {
    minWidth: "46%",
    flex: 1,
    gap: spacing.xs,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  metricValue: {
    ...typography.title1,
    marginTop: spacing.xs,
    fontVariant: ["tabular-nums"],
  },
  metricLabel: { ...typography.label, color: colors.textPrimary },
  metricSupporting: { ...typography.caption, color: colors.textSecondary },
  card: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  cardEmphasized: {
    borderColor: colors.primary,
    backgroundColor: colors.informationalSurface,
  },
  dividedRow: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  orderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  orderLabel: { ...typography.supporting, flex: 1, color: colors.textPrimary },
  orderCount: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    height: 4,
    marginTop: spacing.sm,
    overflow: "hidden",
    borderRadius: radii.full,
    backgroundColor: colors.disabledSurface,
  },
  progressFill: {
    height: "100%",
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  summaryRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.lg,
  },
  summaryRowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  summaryLabel: { ...typography.supporting, flex: 1, color: colors.textSecondary },
  summaryValue: {
    ...typography.bodyStrong,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  activityItem: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md },
  activityItemDivided: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  activityIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.informationalSurface,
  },
  activityContent: { flex: 1, gap: spacing.xs },
  activityMetaRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  activityType: { ...typography.label, color: colors.informational },
  activityTime: { ...typography.caption, color: colors.textSecondary },
  activitySummary: { ...typography.body, color: colors.textPrimary },
  activityActor: { ...typography.caption, color: colors.textSecondary },
  stateContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingVertical: spacing.xxl,
  },
  stateTitle: { ...typography.title2, color: colors.textPrimary, textAlign: "center" },
  stateSupporting: {
    ...typography.body,
    maxWidth: 420,
    color: colors.textSecondary,
    textAlign: "center",
  },
  errorIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.dangerSurface,
  },
  retryButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.sm,
    backgroundColor: colors.primary,
  },
  retryButtonPressed: { backgroundColor: colors.primaryPressed },
  retryLabel: { ...typography.label, color: colors.onPrimary },
  emptyState: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  emptyTitle: { ...typography.bodyStrong, color: colors.textPrimary, textAlign: "center" },
  emptySupporting: {
    ...typography.supporting,
    color: colors.textSecondary,
    textAlign: "center",
  },
  skeleton: { borderRadius: radii.sm, backgroundColor: colors.disabledSurface },
  skeletonHeading: { width: "62%", height: 28, alignSelf: "flex-start" },
  skeletonSegment: { width: "100%", height: 56 },
  skeletonHero: { width: "100%", height: 132 },
  skeletonGrid: { width: "100%", flexDirection: "row", gap: spacing.md },
  skeletonMetric: { flex: 1, height: 132 },
});
