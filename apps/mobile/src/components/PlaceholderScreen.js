import { StyleSheet, Text, View } from "react-native";

import { ProductHeader } from "./ProductHeader";
import { ScreenContainer } from "./ScreenContainer";
import { colors, radii, spacing, typography } from "../theme/tokens";

export function PlaceholderScreen({
  eyebrow,
  title,
  description,
  children,
  productShell = false,
}) {
  return (
    <ScreenContainer fullSafeArea={productShell}>
      {productShell ? (
        <ProductHeader context={description} title={title} />
      ) : (
        <View accessible accessibilityRole="header" style={styles.heading}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>
        </View>
      )}
      {children ? <View style={styles.content}>{children}</View> : null}
    </ScreenContainer>
  );
}

export function CapabilitySummary({ items }) {
  return (
    <View accessibilityLabel="Áreas disponibles" style={styles.card}>
      <Text style={styles.cardTitle}>Áreas disponibles</Text>
      {items.map((item) => (
        <View key={item} style={styles.row}>
          <View accessible={false} style={styles.marker} />
          <Text style={styles.rowText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: spacing.sm,
  },
  eyebrow: {
    ...typography.label,
    color: colors.primary,
    textTransform: "uppercase",
  },
  title: {
    ...typography.title1,
    color: colors.textPrimary,
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
  },
  content: {
    marginTop: spacing.xxl,
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  cardTitle: {
    ...typography.title2,
    color: colors.textPrimary,
  },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  marker: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.informational,
  },
  rowText: {
    ...typography.body,
    flexShrink: 1,
    color: colors.textPrimary,
  },
});
