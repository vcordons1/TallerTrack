import { CapabilityBoundary } from "../../src/components/CapabilityBoundary";
import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";

export default function InternalAgendaScreen() {
  return (
    <CapabilityBoundary destination="agenda">
      <PlaceholderScreen
        title="Agenda"
        description="Citas y solicitudes estarán disponibles en una próxima etapa."
        productShell
      />
    </CapabilityBoundary>
  );
}
