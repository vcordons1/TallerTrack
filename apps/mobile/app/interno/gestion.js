import { CapabilityBoundary } from "../../src/components/CapabilityBoundary";
import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";

export default function InternalManagementScreen() {
  return (
    <CapabilityBoundary destination="management">
      <PlaceholderScreen
        eyebrow="Espacio interno"
        title="Gestión"
        description="Base reservada para clientes y vehículos; la administración de usuarios requiere capacidad administrativa."
      />
    </CapabilityBoundary>
  );
}
