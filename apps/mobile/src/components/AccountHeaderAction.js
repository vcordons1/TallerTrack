import { Link } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";

import { colors, spacing, typography } from "../theme/tokens";

export function AccountHeaderAction({ href }) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityLabel="Abrir cuenta y sesión"
        accessibilityRole="button"
        hitSlop={4}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.label}>Cuenta</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 64,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  pressed: {
    opacity: 0.65,
  },
  label: {
    ...typography.label,
    color: colors.primary,
  },
});
