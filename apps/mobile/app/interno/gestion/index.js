import { router } from "expo-router";
import { Text, View } from "react-native";
import { CapabilityBoundary } from "../../../src/components/CapabilityBoundary";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ProductHeader } from "../../../src/components/ProductHeader";
import { UserButton } from "../../../src/features/users/UserScreens";
import { useSession } from "../../../src/session/SessionProvider";
import { colors, spacing, typography } from "../../../src/theme/tokens";
const { CAPABILITIES, hasInternalCapability } = require("../../../src/navigation/accessPolicy");
export default function ManagementScreen() {
  const { access } = useSession();
  return <CapabilityBoundary destination="management"><ScreenContainer fullSafeArea><View style={{ gap: spacing.xl }}>
    <ProductHeader title="Gestión" />
    {hasInternalCapability(access.roles, CAPABILITIES.CUSTOMERS_VEHICLES) && <>
      <UserButton onPress={() => router.push("/interno/gestion/clientes")}>Clientes</UserButton>
      <UserButton onPress={() => router.push("/interno/gestion/vehiculos")}>Vehículos</UserButton>
    </>}
    {access.roles.includes("ADMINISTRADOR") && <UserButton onPress={() => router.push("/interno/gestion/usuarios")}>Usuarios internos</UserButton>}
    <Text style={{ ...typography.body, color: colors.textSecondary }}>Los clientes registrados aquí no reciben cuenta digital; la activación de clientes sigue pendiente.</Text>
  </View></ScreenContainer></CapabilityBoundary>;
}
