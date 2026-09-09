import { CapabilityBoundary } from "../../src/components/CapabilityBoundary";
import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";

export default function InternalAgendaScreen() {
  return (
    <CapabilityBoundary destination="agenda">
      <PlaceholderScreen
        eyebrow="Espacio interno"
        title="Agenda"
        description="Base reservada para citas y solicitudes del personal autorizado."
      />
    </CapabilityBoundary>
  );
}
