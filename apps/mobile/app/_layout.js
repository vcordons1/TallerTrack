import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider } from "../src/session/SessionProvider";
import { colors } from "../src/theme/tokens";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" backgroundColor={colors.background} />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="acceso" />
          <Stack.Screen name="interno" />
          <Stack.Screen name="cliente" />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
