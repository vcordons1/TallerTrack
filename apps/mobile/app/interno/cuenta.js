import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";
import { useSession } from "../../src/session/SessionProvider";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radii, spacing, typography } from "../../src/theme/tokens";

export default function InternalAccountScreen() {
  const { access, logout } = useSession();

  return (
    <PlaceholderScreen
      eyebrow="Cuenta interna"
      title={access.nombreMostrado}
      description={`Roles vigentes: ${access.roles.join(", ")}. No existe cambio de rol; esta lista es informativa.`}
    >
      <Pressable accessibilityRole="button" onPress={async () => { await logout(); router.replace("/acceso/iniciar-sesion"); }}
        style={styles.button}><Text style={styles.label}>Cerrar sesión</Text></Pressable>
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 52, paddingHorizontal: spacing.lg, justifyContent: "center",
    alignItems: "center", borderRadius: radii.md, backgroundColor: colors.primary },
  label: { ...typography.bodyStrong, color: colors.onPrimary },
});
