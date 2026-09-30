import { Stack } from "expo-router";
import { UserBoundary } from "../../../../src/features/users/UserScreens";
export default function UsersLayout() {
  return <UserBoundary><Stack><Stack.Screen name="index" options={{ title: "Usuarios internos", headerShown: false }} />
    <Stack.Screen name="nuevo" options={{ title: "Crear usuario" }} />
    <Stack.Screen name="[id]" options={{ title: "Detalle de usuario" }} /></Stack></UserBoundary>;
}
