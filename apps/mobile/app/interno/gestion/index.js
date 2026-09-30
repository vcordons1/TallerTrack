import { router } from "expo-router";
import { Text, View } from "react-native";
import { CapabilityBoundary } from "../../../src/components/CapabilityBoundary";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ProductHeader } from "../../../src/components/ProductHeader";
import { UserButton } from "../../../src/features/users/UserScreens";
import { useSession } from "../../../src/session/SessionProvider";
import { colors, spacing, typography } from "../../../src/theme/tokens";
export default function ManagementScreen() {
  const { access } = useSession();
  return <CapabilityBoundary destination="management"><ScreenContainer fullSafeArea><View style={{ gap: spacing.xl }}>
    <ProductHeader title="Gestión" />
    {access.roles.includes("ADMINISTRADOR") && <UserButton onPress={() => router.push("/interno/gestion/usuarios")}>Usuarios internos</UserButton>}
    <Text style={{ ...typography.body, color: colors.textSecondary }}>El alta y mantenimiento de clientes y vehículos estarán disponibles en una próxima etapa.</Text>
  </View></ScreenContainer></CapabilityBoundary>;
}
