import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AccountHeaderAction } from "../../components/AccountHeaderAction";
import { colors, radii, spacing, typography } from "../../theme/tokens";

const {
  EVENT_LABELS,
  ORDER_STATUS_PRESENTATION,
  WORK_STATUS_PRESENTATION,
  formatDateTime,
  formatMoney,
  formatQuantity,
  getOrderAttention,
  getOrderCode,
  getVehicleLabel,
} = require("./orderPresentation");

const TONES = Object.freeze({
  neutral: { foreground: colors.textSecondary, surface: colors.surfaceMuted },
  info: { foreground: colors.informational, surface: colors.informationalSurface },
  success: { foreground: colors.success, surface: colors.successSurface },
  warning: { foreground: colors.warning, surface: colors.warningSurface },
  danger: { foreground: colors.danger, surface: colors.dangerSurface },
});

export function StatusBadge({ state, presentation = ORDER_STATUS_PRESENTATION }) {
  const item = presentation[state] ?? {
    label: "Estado no reconocido",
    tone: "danger",
    icon: "help-circle-outline",
  };
  const palette = TONES[item.tone];

  return (
    <View
      accessible
      accessibilityLabel={`Estado: ${item.label}`}
      style={[styles.badge, { backgroundColor: palette.surface }]}
    >
      {item.icon ? (
        <MaterialCommunityIcons
          accessible={false}
          color={palette.foreground}
          name={item.icon}
          size={16}
        />
      ) : null}
      <Text numberOfLines={1} style={[styles.badgeLabel, { color: palette.foreground }]}>
        {item.label}
      </Text>
    </View>
  );
}

export function FilterChip({ label, selected, onPress }) {
  return (
    <Pressable
      accessibilityLabel={`Filtrar por ${label}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        selected && styles.filterChipSelected,
        pressed && styles.filterChipPressed,
      ]}
    >
      {selected ? <View accessible={false} style={styles.filterDot} /> : null}
      <Text numberOfLines={1} style={[styles.filterLabel, selected && styles.filterLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function OrderListItem({ order, onPress }) {
  const attention = getOrderAttention(order);
  const attentionPalette = TONES[attention.tone];
  const vehicle = getVehicleLabel(order.vehiculo);
  const code = getOrderCode(order.id);

  return (
    <Pressable
      accessibilityHint="Abre el detalle de la orden"
      accessibilityLabel={`${code}. ${vehicle}. ${ORDER_STATUS_PRESENTATION[order.estado]?.label ?? order.estado}. ${attention.label}.`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.orderRow, pressed && styles.orderRowPressed]}
    >
      <View style={styles.orderMainRow}>
        <View style={styles.orderIdentity}>
          <Text style={styles.orderCode}>{code}</Text>
          <Text style={styles.orderVehicle}>{vehicle}</Text>
        </View>
        <MaterialCommunityIcons
          accessible={false}
          color={colors.textSecondary}
          name="chevron-right"
          size={24}
        />
      </View>
      <StatusBadge state={order.estado} />
      <View style={styles.orderMetadata}>
        {order.vehiculo?.placa ? (
          <Text style={styles.metadataText}>Placa {order.vehiculo.placa}</Text>
        ) : null}
        {order.clienteContractual ? <Text style={styles.metadataText}>{order.clienteContractual.nombre}</Text> : null}
        {order.ingresadoEn ? <Text style={styles.metadataText}>Ingresó {formatDateTime(order.ingresadoEn)}</Text> : null}
        {!order.vehiculo ? <Text style={styles.metadataText}>{order.proposito === "GARANTIA" ? "Garantía" : "Comercial"}</Text> : null}
      </View>
      <View style={styles.attentionLine}>
        <MaterialCommunityIcons
          accessible={false}
          color={attentionPalette.foreground}
          name={attention.icon}
          size={18}
        />
        <Text style={[styles.attentionText, { color: attentionPalette.foreground }]}>
          {attention.label}
        </Text>
      </View>
    </Pressable>
  );
}

export function DetailTopBar({ onBack }) {
  return (
    <View style={styles.topBar}>
      <Pressable
        accessibilityLabel="Volver al listado de órdenes"
        accessibilityRole="button"
        hitSlop={4}
        onPress={onBack}
        style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
      >
        <MaterialCommunityIcons accessible={false} color={colors.primary} name="arrow-left" size={24} />
      </Pressable>
      <View style={styles.topBarTitleGroup}>
        <Text style={styles.topBarEyebrow}>TallerTrack</Text>
        <Text accessibilityRole="header" style={styles.topBarTitle}>Detalle de orden</Text>
      </View>
      <AccountHeaderAction href="/interno/cuenta" />
    </View>
  );
}

export function OrderSummaryHeader({ order }) {
  const attention = getOrderAttention(order);
  return (
    <View style={styles.summaryHeader}>
      <View accessible={false} style={styles.summaryShapeLarge} />
      <View accessible={false} style={styles.summaryShapeSmall} />
      <View style={styles.summaryTopRow}>
        <Text style={styles.summaryCode}>{getOrderCode(order.id)}</Text>
        <StatusBadge state={order.estado} />
      </View>
      <View style={styles.summaryIdentity}>
        <Text style={styles.summaryVehicle}>{getVehicleLabel(order.vehiculo)}</Text>
        <Text style={styles.summarySupporting}>
          {order.vehiculo?.placa
            ? `Placa ${order.vehiculo.placa}`
            : order.vehiculo
              ? "Sin placa registrada"
              : `Vista mínima de ${order.proposito === "GARANTIA" ? "garantía" : "orden comercial"}`}
        </Text>
      </View>
      <View accessible accessibilityLabel={`Atención actual: ${attention.label}`} style={styles.nowPanel}>
        <MaterialCommunityIcons accessible={false} color={colors.onPrimary} name={attention.icon} size={22} />
        <View style={styles.nowCopy}>
          <Text style={styles.nowEyebrow}>NECESITA AHORA</Text>
          <Text style={styles.nowText}>{attention.label}</Text>
        </View>
      </View>
    </View>
  );
}

export function DetailSection({ icon, title, description, children }) {
  return (
    <View style={styles.detailSection}>
      <View style={styles.sectionHeading}>
        <View style={styles.sectionIcon}>
          <MaterialCommunityIcons accessible={false} color={colors.primary} name={icon} size={20} />
        </View>
        <View style={styles.sectionHeadingCopy}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
          {description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
        </View>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export function KeyValueRow({ label, value, last = false, emphasis = false }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={[styles.keyValueRow, !last && styles.dividerBottom]}>
      <Text style={styles.keyLabel}>{label}</Text>
      <Text style={[styles.keyValue, emphasis && styles.keyValueEmphasis]}>{value}</Text>
    </View>
  );
}

export function WorkItem({ work, last = false }) {
  return (
    <View style={[styles.resourceRow, !last && styles.dividerBottom]}>
      <View style={styles.resourceHeader}>
        <View style={styles.resourceCopy}>
          <Text style={styles.resourceEyebrow}>{work.tipo === "DIAGNOSTICO" ? "DIAGNÓSTICO" : "REPARACIÓN"}</Text>
          <Text style={styles.resourceTitle}>{work.descripcion}</Text>
        </View>
        <StatusBadge state={work.estado} presentation={WORK_STATUS_PRESENTATION} />
      </View>
      <Text style={styles.resourceSupporting}>
        {work.horasEjecutadas} h ejecutadas · {work.tipoServicio.replaceAll("_", " ").toLowerCase()}
      </Text>
    </View>
  );
}

export function PartItem({ item, last = false }) {
  const { repuesto, reserva } = item;
  return (
    <View style={[styles.resourceRow, !last && styles.dividerBottom]}>
      <Text style={styles.resourceEyebrow}>{repuesto.codigo}</Text>
      <Text style={styles.resourceTitle}>{repuesto.descripcion}</Text>
      <Text style={styles.resourceSupporting}>
        Reservado {formatQuantity(reserva.cantidadReservada)} · consumido {formatQuantity(reserva.cantidadConsumida)} · activo {formatQuantity(reserva.cantidadActiva)}
      </Text>
    </View>
  );
}

export function MoneySummary({ balance }) {
  return (
    <View style={styles.moneySummary}>
      <KeyValueRow label="Cargos registrados" value={formatMoney(balance.montoDebido)} />
      <KeyValueRow label="Pagado válido" value={formatMoney(balance.pagadoValido)} />
      <KeyValueRow label="Saldo pendiente" value={formatMoney(balance.saldoPendiente)} emphasis={!balance.deudaVencida} />
      {balance.deudaVencida ? (
        <View accessible accessibilityLabel="El saldo está vencido desde la entrega" style={styles.debtNotice}>
          <MaterialCommunityIcons accessible={false} color={colors.danger} name="alert-circle-outline" size={20} />
          <Text style={styles.debtText}>Saldo vencido desde la entrega</Text>
        </View>
      ) : null}
    </View>
  );
}

export function TimelineItem({ event, last = false }) {
  return (
    <View style={styles.timelineItem}>
      <View style={styles.timelineRail}>
        <View style={styles.timelineDot} />
        {!last ? <View accessible={false} style={styles.timelineLine} /> : null}
      </View>
      <View style={[styles.timelineCopy, !last && styles.timelineSpacing]}>
        <Text style={styles.timelineTitle}>{EVENT_LABELS[event.tipo] ?? event.tipo}</Text>
        <Text style={styles.timelineTime}>{formatDateTime(event.registradoEn)}</Text>
        <Text style={styles.timelineReason}>{event.motivo}</Text>
        <Text style={styles.timelineActor}>Por {event.actor.nombre}</Text>
      </View>
    </View>
  );
}

export function OrdersLoading({ detail = false }) {
  return (
    <View accessibilityLabel={detail ? "Cargando detalle de orden" : "Cargando órdenes"} accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={styles.stateContainer}>
      <View style={[styles.skeleton, styles.skeletonBrand]} />
      <View style={[styles.skeleton, styles.skeletonTitle]} />
      <View style={[styles.skeleton, detail ? styles.skeletonDetailHero : styles.skeletonFilters]} />
      <View style={[styles.skeleton, styles.skeletonRow]} />
      <View style={[styles.skeleton, styles.skeletonRow]} />
      <Text style={styles.stateSupporting}>{detail ? "Reconstruyendo la atención…" : "Preparando la cola operativa…"}</Text>
    </View>
  );
}

export function OrdersError({ title, message, onRetry, onBack }) {
  return (
    <View accessibilityLiveRegion="assertive" style={styles.stateContainer}>
      <View style={styles.errorIcon}>
        <MaterialCommunityIcons accessible={false} color={colors.danger} name="alert-circle-outline" size={24} />
      </View>
      <Text accessibilityRole="header" style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateSupporting}>{message}</Text>
      <View style={styles.stateActions}>
        {onBack ? <StateButton label="Volver a órdenes" icon="arrow-left" onPress={onBack} secondary /> : null}
        {onRetry ? <StateButton label="Reintentar" icon="refresh" onPress={onRetry} /> : null}
      </View>
    </View>
  );
}

export function OrdersEmpty({ filtered = false, title = "Aún no hay órdenes",
  supporting = "La lectura fue correcta, pero no devolvió atenciones." }) {
  return (
    <View accessible style={styles.emptyState}>
      <MaterialCommunityIcons accessible={false} color={colors.textSecondary} name="clipboard-text-clock-outline" size={28} />
      <Text style={styles.emptyTitle}>{filtered ? "No hay órdenes en este filtro" : title}</Text>
      <Text style={styles.emptySupporting}>{filtered ? "Selecciona otra vista para continuar revisando la operación." : supporting}</Text>
    </View>
  );
}

function StateButton({ label, icon, onPress, secondary = false }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.stateButton, secondary && styles.stateButtonSecondary, pressed && (secondary ? styles.stateButtonSecondaryPressed : styles.stateButtonPressed)]}
    >
      <MaterialCommunityIcons accessible={false} color={secondary ? colors.primary : colors.onPrimary} name={icon} size={20} />
      <Text style={[styles.stateButtonLabel, secondary && styles.stateButtonLabelSecondary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { minHeight: 32, maxWidth: "100%", alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radii.full },
  badgeLabel: { ...typography.caption, flexShrink: 1, fontWeight: "700" },
  filterChip: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.full, backgroundColor: colors.surface },
  filterChipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  filterChipPressed: { opacity: 0.72 },
  filterDot: { width: 6, height: 6, borderRadius: radii.full, backgroundColor: colors.primary },
  filterLabel: { ...typography.label, color: colors.textSecondary },
  filterLabelSelected: { color: colors.primary },
  orderRow: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface },
  orderRowPressed: { backgroundColor: colors.primarySurface },
  orderMainRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  orderIdentity: { minWidth: 0, flex: 1, gap: spacing.xs },
  orderCode: { ...typography.caption, color: colors.primary, fontWeight: "700", letterSpacing: 0.6 },
  orderVehicle: { ...typography.title2, color: colors.textPrimary },
  orderMetadata: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, rowGap: spacing.xs },
  metadataText: { ...typography.supporting, color: colors.textSecondary },
  attentionLine: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  attentionText: { ...typography.label, flex: 1 },
  topBar: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.lg, backgroundColor: colors.primarySurface },
  iconButtonPressed: { backgroundColor: colors.surfaceMuted },
  topBarTitleGroup: { minWidth: 0, flex: 1 },
  topBarEyebrow: { ...typography.caption, color: colors.primary, fontWeight: "700" },
  topBarTitle: { ...typography.bodyStrong, color: colors.textPrimary },
  summaryHeader: { minHeight: 244, overflow: "hidden", gap: spacing.lg, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.primary },
  summaryShapeLarge: { position: "absolute", width: 190, height: 190, top: -90, right: -70, borderRadius: radii.full, backgroundColor: colors.onPrimary, opacity: 0.08 },
  summaryShapeSmall: { position: "absolute", width: 74, height: 74, right: 64, bottom: -32, borderRadius: radii.full, backgroundColor: colors.onPrimary, opacity: 0.07 },
  summaryTopRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  summaryCode: { ...typography.label, color: colors.onPrimary, fontWeight: "700", letterSpacing: 0.7 },
  summaryIdentity: { gap: spacing.xs },
  summaryVehicle: { ...typography.display, color: colors.onPrimary },
  summarySupporting: { ...typography.body, color: colors.onPrimary, opacity: 0.88 },
  nowPanel: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: "auto", padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.onPrimarySubtle },
  nowCopy: { minWidth: 0, flex: 1, gap: 2 },
  nowEyebrow: { ...typography.caption, color: colors.onPrimary, fontWeight: "700", letterSpacing: 0.7, opacity: 0.8 },
  nowText: { ...typography.bodyStrong, color: colors.onPrimary },
  detailSection: { overflow: "hidden", borderRadius: radii.lg, backgroundColor: colors.surface },
  sectionHeading: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.lg, backgroundColor: colors.surfaceMuted },
  sectionIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radii.md, backgroundColor: colors.primarySurface },
  sectionHeadingCopy: { minWidth: 0, flex: 1, gap: 2 },
  sectionTitle: { ...typography.title2, color: colors.textPrimary },
  sectionDescription: { ...typography.supporting, color: colors.textSecondary },
  sectionBody: { paddingHorizontal: spacing.lg },
  keyValueRow: { minHeight: 60, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: spacing.lg, rowGap: spacing.xs, paddingVertical: spacing.md },
  keyLabel: { ...typography.supporting, maxWidth: 128, flexShrink: 1, color: colors.textSecondary },
  keyValue: { ...typography.bodyStrong, minWidth: 160, flex: 1, color: colors.textPrimary, textAlign: "right", fontVariant: ["tabular-nums"] },
  keyValueEmphasis: { color: colors.warning },
  dividerBottom: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  resourceRow: { gap: spacing.xs, paddingVertical: spacing.lg },
  resourceHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: spacing.md },
  resourceCopy: { minWidth: 180, flex: 1, gap: spacing.xs },
  resourceEyebrow: { ...typography.caption, color: colors.primary, fontWeight: "700", letterSpacing: 0.5 },
  resourceTitle: { ...typography.bodyStrong, color: colors.textPrimary },
  resourceSupporting: { ...typography.supporting, color: colors.textSecondary },
  moneySummary: { paddingBottom: spacing.md },
  debtNotice: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.dangerSurface },
  debtText: { ...typography.label, flex: 1, color: colors.danger },
  timelineItem: { flexDirection: "row", gap: spacing.md },
  timelineRail: { width: 20, alignItems: "center", paddingTop: 5 },
  timelineDot: { width: 12, height: 12, borderWidth: 3, borderColor: colors.primarySurface, borderRadius: radii.full, backgroundColor: colors.primary },
  timelineLine: { width: 2, flex: 1, marginVertical: spacing.xs, backgroundColor: colors.border },
  timelineCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  timelineSpacing: { paddingBottom: spacing.xl },
  timelineTitle: { ...typography.bodyStrong, color: colors.textPrimary },
  timelineTime: { ...typography.caption, color: colors.primary },
  timelineReason: { ...typography.supporting, color: colors.textSecondary },
  timelineActor: { ...typography.caption, color: colors.textSecondary },
  stateContainer: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center", alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.xxl },
  stateTitle: { ...typography.title2, color: colors.textPrimary, textAlign: "center" },
  stateSupporting: { ...typography.body, maxWidth: 420, color: colors.textSecondary, textAlign: "center" },
  stateActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm, marginTop: spacing.sm },
  stateButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.md, backgroundColor: colors.primary },
  stateButtonSecondary: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  stateButtonPressed: { backgroundColor: colors.primaryPressed },
  stateButtonSecondaryPressed: { backgroundColor: colors.primarySurface },
  stateButtonLabel: { ...typography.label, color: colors.onPrimary },
  stateButtonLabelSecondary: { color: colors.primary },
  errorIcon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.lg, backgroundColor: colors.dangerSurface },
  emptyState: { alignItems: "center", gap: spacing.sm, padding: spacing.xxl },
  emptyTitle: { ...typography.bodyStrong, color: colors.textPrimary, textAlign: "center" },
  emptySupporting: { ...typography.supporting, maxWidth: 360, color: colors.textSecondary, textAlign: "center" },
  skeleton: { borderRadius: radii.md, backgroundColor: colors.disabledSurface },
  skeletonBrand: { width: 136, height: 24, alignSelf: "flex-start" },
  skeletonTitle: { width: "72%", height: 34, alignSelf: "flex-start" },
  skeletonFilters: { width: "100%", height: 104 },
  skeletonDetailHero: { width: "100%", height: 244 },
  skeletonRow: { width: "100%", height: 148 },
});
