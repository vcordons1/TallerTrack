import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "./ScreenContainer";
import { colors, spacing, typography } from "../theme/tokens";

export function SessionLoading() {
  return (
    <ScreenContainer fullSafeArea scroll={false}>
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="progressbar"
        accessibilityLabel="Resolviendo sesión"
        style={styles.center}
      >
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.title}>TallerTrack</Text>
        <Text style={styles.message}>Resolviendo sesión…</Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  title: {
    ...typography.title1,
    color: colors.textPrimary,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
