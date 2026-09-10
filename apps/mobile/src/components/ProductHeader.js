import { StyleSheet, Text, View } from "react-native";

import { AccountHeaderAction } from "./AccountHeaderAction";
import { colors, spacing, typography } from "../theme/tokens";

export function ProductHeader({ context, title, accountHref = "/interno/cuenta" }) {
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <View style={styles.brand}>
          <View accessible={false} style={styles.brandMark}>
            <View style={styles.brandMarkCore} />
          </View>
          <Text style={styles.brandName}>TallerTrack</Text>
        </View>
        <AccountHeaderAction href={accountHref} />
      </View>
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {context ? <Text style={styles.context}>{context}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xl,
  },
  brandRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  brandMark: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  brandMarkCore: {
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: colors.onPrimary,
  },
  brandName: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  copy: {
    gap: spacing.xs,
  },
  title: {
    ...typography.title1,
    color: colors.textPrimary,
  },
  context: {
    ...typography.supporting,
    color: colors.textSecondary,
  },
});
