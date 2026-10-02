import { Stack } from "expo-router";
export default function ManagementLayout() {
  return <Stack><Stack.Screen name="index" options={{ headerShown: false }} />
    <Stack.Screen name="usuarios" options={{ headerShown: false }} />
    <Stack.Screen name="clientes" options={{ headerShown: false }} />
    <Stack.Screen name="vehiculos" options={{ headerShown: false }} /></Stack>;
}
