import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Link } from "expo-router";
import { Pressable, StyleSheet } from "react-native";

import { colors, radii } from "../theme/tokens";

export function AccountHeaderAction({ href }) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityLabel="Abrir cuenta y sesión"
        accessibilityRole="button"
        hitSlop={4}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons
          accessible={false}
          color={colors.primary}
          name="account-outline"
          size={24}
        />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.lg,
    backgroundColor: colors.primarySurface,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
});
