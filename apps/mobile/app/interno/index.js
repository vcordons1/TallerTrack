import {
  CapabilitySummary,
  PlaceholderScreen,
} from "../../src/components/PlaceholderScreen";
import { DashboardScreen } from "../../src/features/dashboard/DashboardScreen";
import { useSession } from "../../src/session/SessionProvider";

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
    </PlaceholderScreen>
  );
}
