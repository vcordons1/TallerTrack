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
    return <DashboardScreen />;
  }

  return (
    <PlaceholderScreen
      eyebrow="Espacio interno"
      title={`Hola, ${access.nombreMostrado}`}
      description="El inicio y los destinos visibles se componen con las capacidades vigentes de esta identidad."
    >
      <CapabilitySummary items={items.length > 0 ? items : ["Inicio interno"]} />
    </PlaceholderScreen>
  );
}
