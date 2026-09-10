import { CapabilityBoundary } from "../../src/components/CapabilityBoundary";
import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";

export default function InternalManagementScreen() {
  return (
    <CapabilityBoundary destination="management">
      <PlaceholderScreen
        title="Gestión"
        description="Clientes, vehículos y usuarios estarán disponibles en una próxima etapa."
        productShell
      />
    </CapabilityBoundary>
  );
}
