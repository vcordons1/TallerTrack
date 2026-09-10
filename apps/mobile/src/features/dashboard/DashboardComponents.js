import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, typography } from "../../theme/tokens";

const TONES = Object.freeze({
  neutral: { foreground: colors.textPrimary, surface: colors.surfaceMuted },
  info: { foreground: colors.informational, surface: colors.informationalSurface },
  success: { foreground: colors.success, surface: colors.successSurface },
  warning: { foreground: colors.warning, surface: colors.warningSurface },
  danger: { foreground: colors.danger, surface: colors.dangerSurface },
});

const ACTIVITY_ICONS = Object.freeze({
  ORDEN: "clipboard-text-outline",
  PAGO: "cash-check",
  INVENTARIO: "package-variant-closed-check",
  GARANTIA: "shield-check-outline",
});

const ACTIVITY_TONES = Object.freeze({
  ORDEN: "info",
  PAGO: "success",
  INVENTARIO: "warning",
  GARANTIA: "success",
});

export function SectionHeader({ title, description }) {
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
    </View>
  );
}

export function PeriodSelector({ value, onChange, options }) {
  return (
    <View accessibilityLabel="Período del Dashboard" accessibilityRole="tablist" style={styles.segmentedControl}>
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
            <View style={styles.segmentLabelRow}>
              {selected ? <View accessible={false} style={styles.segmentDot} /> : null}
              <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{option.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AttentionRow({ icon, label, value, tone = "warning", last = false }) {
  const palette = TONES[tone];
  return (
    <View
      accessible
      accessibilityLabel={`${value} ${label}`}
      style={[styles.attentionRow, !last && styles.dividerBottom]}
    >
      <View style={[styles.attentionIcon, { backgroundColor: palette.surface }]}>
        <MaterialCommunityIcons accessible={false} color={palette.foreground} name={icon} size={20} />
      </View>
      <Text style={styles.attentionLabel}>{label}</Text>
      <Text style={[styles.attentionValue, { color: palette.foreground }]}>{value}</Text>
    </View>
  );
}

export function OrderStatusGrid({ items }) {
  return (
    <View style={styles.statusGrid}>
      {items.map((item) => {
        const palette = TONES[item.tone ?? "neutral"];
        return (
          <View
            accessible
            accessibilityLabel={`${item.label}: ${item.cantidad}`}
            key={item.estado}
            style={[styles.statusTile, { backgroundColor: palette.surface }]}
          >
            <View style={[styles.statusMarker, { backgroundColor: palette.foreground }]} />
            <Text style={styles.statusCount}>{item.cantidad}</Text>
            <Text style={styles.statusLabel}>{item.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function MetricTile({ icon, label, value, supporting, tone = "neutral", wide = false }) {
  const palette = TONES[tone];
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${supporting ? `. ${supporting}` : ""}`}
      style={[styles.metricTile, wide && styles.metricTileWide]}
    >
      <View style={styles.metricTopRow}>
        <MaterialCommunityIcons accessible={false} color={palette.foreground} name={icon} size={20} />
        <Text style={[styles.metricValue, { color: palette.foreground }]}>{value}</Text>
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      {supporting ? <Text style={styles.metricSupporting}>{supporting}</Text> : null}
    </View>
  );
}

export function SummarySurface({ children }) {
  return <View style={styles.summarySurface}>{children}</View>;
}

export function OperationalTimelineItem({ item, typeLabel, actionLabel, formattedTime, last }) {
  const palette = TONES[ACTIVITY_TONES[item.tipo] ?? "info"];
  return (
    <View style={styles.timelineItem}>
      <View style={styles.timelineRail}>
        <View style={[styles.timelineIcon, { backgroundColor: palette.surface }]}>
          <MaterialCommunityIcons
            accessible={false}
            color={palette.foreground}
            name={ACTIVITY_ICONS[item.tipo] ?? "circle-outline"}
            size={18}
          />
        </View>
        {!last ? <View accessible={false} style={styles.timelineLine} /> : null}
      </View>
      <View accessible style={[styles.timelineContent, !last && styles.timelineSpacing]}>
        <View style={styles.timelineMetaRow}>
          <Text style={[styles.timelineType, { color: palette.foreground }]}>{typeLabel}</Text>
          <Text style={styles.timelineTime}>{formattedTime}</Text>
        </View>
        <Text style={styles.timelineAction}>{actionLabel}</Text>
        <Text style={styles.timelineSummary}>{item.resumen}</Text>
        {item.actor ? <Text style={styles.timelineActor}>Por {item.actor.nombre}</Text> : null}
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
      <View style={[styles.skeleton, styles.skeletonBrand]} />
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
        <MaterialCommunityIcons accessible={false} color={colors.danger} name="alert-circle-outline" size={24} />
      </View>
      <Text accessibilityRole="header" style={styles.stateTitle}>No pudimos cargar el Dashboard</Text>
      <Text style={styles.stateSupporting}>{message}</Text>
      <Pressable
        accessibilityLabel="Reintentar carga del Dashboard"
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
      >
        <MaterialCommunityIcons accessible={false} color={colors.onPrimary} name="refresh" size={20} />
        <Text style={styles.retryLabel}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

export function ActivityEmptyState() {
  return (
    <View accessible style={styles.emptyState}>
      <MaterialCommunityIcons accessible={false} color={colors.textSecondary} name="timeline-clock-outline" size={24} />
      <Text style={styles.emptyTitle}>Sin actividad en este período</Text>
      <Text style={styles.emptySupporting}>No se registraron hechos recientes para el rango seleccionado.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { gap: spacing.xs },
  sectionTitle: { ...typography.title2, color: colors.textPrimary },
  sectionDescription: { ...typography.supporting, color: colors.textSecondary },
  segmentedControl: { flexDirection: "row", padding: spacing.xs, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted },
  segment: { minHeight: 48, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radii.md, paddingHorizontal: spacing.md },
  segmentSelected: {
    backgroundColor: colors.surface,
    elevation: 2,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
  },
  segmentPressed: { opacity: 0.72 },
  segmentLabelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  segmentDot: { width: 6, height: 6, borderRadius: radii.full, backgroundColor: colors.primary },
  segmentLabel: { ...typography.label, color: colors.textSecondary },
  segmentLabelSelected: { color: colors.primary },
  attentionRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, marginHorizontal: spacing.lg },
  dividerBottom: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  attentionIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
  attentionLabel: { ...typography.body, flex: 1, color: colors.textPrimary },
  attentionValue: { ...typography.title2, fontVariant: ["tabular-nums"] },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statusTile: { minWidth: 132, flexGrow: 1, flexBasis: "30%", gap: spacing.xs, padding: spacing.md, borderRadius: radii.md },
  statusMarker: { width: 24, height: 3, marginBottom: spacing.xs, borderRadius: radii.full },
  statusCount: { ...typography.title1, color: colors.textPrimary, fontVariant: ["tabular-nums"] },
  statusLabel: { ...typography.supporting, color: colors.textSecondary },
  metricTile: { minWidth: 132, flexGrow: 1, flexBasis: "44%", gap: spacing.xs, paddingVertical: spacing.md },
  metricTileWide: { flexBasis: "100%" },
  metricTopRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  metricValue: { ...typography.title2, fontVariant: ["tabular-nums"] },
  metricLabel: { ...typography.label, color: colors.textPrimary },
  metricSupporting: { ...typography.caption, color: colors.textSecondary },
  summarySurface: { paddingHorizontal: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface },
  timelineItem: { flexDirection: "row", gap: spacing.md },
  timelineRail: { width: 40, alignItems: "center" },
  timelineIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
  timelineLine: { width: 1, flex: 1, marginVertical: spacing.xs, backgroundColor: colors.border },
  timelineContent: { minWidth: 0, flex: 1, gap: spacing.xs, paddingTop: 1 },
  timelineSpacing: { paddingBottom: spacing.xl },
  timelineMetaRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
  timelineType: { ...typography.caption, fontWeight: "700", textTransform: "uppercase" },
  timelineTime: { ...typography.caption, color: colors.textSecondary },
  timelineAction: { ...typography.bodyStrong, color: colors.textPrimary },
  timelineSummary: { ...typography.supporting, color: colors.textSecondary },
  timelineActor: { ...typography.caption, color: colors.textSecondary },
  stateContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingVertical: spacing.xxl },
  stateTitle: { ...typography.title2, color: colors.textPrimary, textAlign: "center" },
  stateSupporting: { ...typography.body, maxWidth: 420, color: colors.textSecondary, textAlign: "center" },
  errorIcon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.lg, backgroundColor: colors.dangerSurface },
  retryButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.md, backgroundColor: colors.primary },
  retryButtonPressed: { backgroundColor: colors.primaryPressed },
  retryLabel: { ...typography.label, color: colors.onPrimary },
  emptyState: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.bodyStrong, color: colors.textPrimary, textAlign: "center" },
  emptySupporting: { ...typography.supporting, color: colors.textSecondary, textAlign: "center" },
  skeleton: { borderRadius: radii.md, backgroundColor: colors.disabledSurface },
  skeletonBrand: { width: 132, height: 24, alignSelf: "flex-start" },
  skeletonHeading: { width: "70%", height: 34, alignSelf: "flex-start" },
  skeletonSegment: { width: "100%", height: 56 },
  skeletonHero: { width: "100%", height: 210 },
  skeletonGrid: { width: "100%", flexDirection: "row", gap: spacing.md },
  skeletonMetric: { flex: 1, height: 112 },
});
