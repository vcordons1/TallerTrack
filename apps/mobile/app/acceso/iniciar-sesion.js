import { useEffect, useState } from "react";
import { router } from "expo-router";
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "../../src/components/ScreenContainer";
import {
  colors,
  radii,
  spacing,
  typography,
} from "../../src/theme/tokens";
import { useSession } from "../../src/session/SessionProvider";
const { getAuthenticatedRoot } = require("../../src/navigation/accessPolicy");

export default function SignInScreen() {
  const session = useSession();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);

  async function submit() {
    if (busy) return;
    if (!login.trim() || !password) { setError("Ingresa tu usuario y contraseña."); return; }
    setBusy(true);
    setError("");
    try {
      const access = await session.login(login.trim(), password);
      setPassword("");
      router.replace(getAuthenticatedRoot(access));
    } catch (failure) {
      setError(failure.status === 401 ? "No fue posible validar el acceso. Revisa tus datos." :
        failure.status === 429 ? "Demasiados intentos. Espera antes de volver a intentar." :
          "No se pudo conectar. Revisa la red de la laptop e intenta de nuevo.");
    } finally { setBusy(false); }
  }

  return (
    <ScreenContainer fullSafeArea>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.center, keyboardOpen && styles.keyboardOpen]}>
        <View accessible accessibilityRole="header" style={styles.heading}>
          <Text style={styles.brand}>TallerTrack</Text>
          <Text style={styles.title}>Iniciar sesión</Text>
          <Text style={styles.description}>
            Ingresa con tu cuenta del taller.
          </Text>
        </View>
        <View style={styles.form}>
          <Text style={styles.noticeTitle}>Usuario</Text>
          <TextInput accessibilityLabel="Usuario" autoCapitalize="none" autoComplete="username"
            value={login} onChangeText={setLogin} style={styles.input} maxLength={150} />
          <Text style={styles.noticeTitle}>Contraseña</Text>
          <TextInput accessibilityLabel="Contraseña" autoCapitalize="none" autoComplete="password"
            secureTextEntry value={password} onChangeText={setPassword} style={styles.input} />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy}
            onPress={submit} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Iniciar sesión</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    flexGrow: 1,
    justifyContent: "center",
    gap: spacing.xl,
  },
  keyboardOpen: { justifyContent: "flex-start" },
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
  form: { gap: spacing.sm },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
    backgroundColor: colors.surface, paddingHorizontal: spacing.lg, ...typography.body, color: colors.textPrimary },
  button: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radii.md,
    backgroundColor: colors.primary, marginTop: spacing.md },
  pressed: { backgroundColor: colors.primaryPressed },
  buttonText: { ...typography.bodyStrong, color: colors.onPrimary },
  error: { ...typography.supporting, color: colors.danger },
});
