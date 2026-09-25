import {
  CapabilitySummary,
  PlaceholderScreen,
} from "../../src/components/PlaceholderScreen";
import { DashboardScreen } from "../../src/features/dashboard/DashboardScreen";
import { useSession } from "../../src/session/SessionProvider";
import { router } from "expo-router";
import { Pressable, Text } from "react-native";
import { colors, radii, spacing, typography } from "../../src/theme/tokens";

const {
  getInternalDestinations,
  CAPABILITIES,
  hasInternalCapability,
} = require("../../src/navigation/accessPolicy");

export default function InternalHomeScreen() {
  const { access } = useSession();
  const destinations = getInternalDestinations(access.roles);
  const items = destinations
    .filter(({ key }) => key !== "home")
    .map(({ title }) => title);

  if (hasInternalCapability(access.roles, CAPABILITIES.ADMIN_DASHBOARD)) {
    return <DashboardScreen userName={access.nombreMostrado} />;
  }

  return (
    <PlaceholderScreen
      title={`Hola, ${access.nombreMostrado}`}
      description="Tu espacio de trabajo muestra únicamente los destinos disponibles para esta identidad."
      productShell
    >
      <CapabilitySummary items={items.length > 0 ? items : ["Inicio interno"]} />
      {hasInternalCapability(access.roles, CAPABILITIES.RECEPTION_CREATE) ?
        <Pressable accessibilityRole="button" onPress={() => router.push("/interno/ordenes/nueva")}
          style={{ minHeight: 52, justifyContent: "center", alignItems: "center",
            borderRadius: radii.md, backgroundColor: colors.primary, paddingHorizontal: spacing.lg }}>
          <Text style={{ ...typography.bodyStrong, color: colors.onPrimary }}>Nueva recepción</Text>
        </Pressable> : null}
    </PlaceholderScreen>
  );
}
