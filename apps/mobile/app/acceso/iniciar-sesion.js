import { StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../../src/components/ScreenContainer";
import {
  colors,
  radii,
  spacing,
  typography,
} from "../../src/theme/tokens";

export default function SignInScreen() {
  return (
    <ScreenContainer fullSafeArea scroll={false}>
      <View style={styles.center}>
        <View accessible accessibilityRole="header" style={styles.heading}>
          <Text style={styles.brand}>TallerTrack</Text>
          <Text style={styles.title}>Iniciar sesión</Text>
          <Text style={styles.description}>
            El acceso se conectará al servicio de identidad cuando cierre G-01.
          </Text>
        </View>
        <View accessibilityRole="summary" style={styles.notice}>
          <Text style={styles.noticeTitle}>Acceso aún no habilitado</Text>
          <Text style={styles.noticeText}>
            Esta entrega valida la resolución de sesión y mantiene separados los
            espacios de cliente y personal interno.
          </Text>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.xl,
  },
  heading: {
    gap: spacing.sm,
  },
  brand: {
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
  notice: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.informationalSurface,
  },
  noticeTitle: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  noticeText: {
    ...typography.body,
    color: colors.textPrimary,
  },
});
