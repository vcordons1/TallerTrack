import {
  CapabilitySummary,
  PlaceholderScreen,
} from "../../src/components/PlaceholderScreen";
import { useSession } from "../../src/session/SessionProvider";

const {
  deriveInternalCapabilities,
  getInternalDestinations,
  CAPABILITIES,
} = require("../../src/navigation/accessPolicy");

export default function InternalHomeScreen() {
  const { access } = useSession();
  const destinations = getInternalDestinations(access.roles);
  const capabilities = deriveInternalCapabilities(access.roles);
  const items = destinations
    .filter(({ key }) => key !== "home")
    .map(({ title }) => title);

  if (capabilities.has(CAPABILITIES.ADMIN_DASHBOARD)) {
    items.unshift("Resumen administrativo");
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
