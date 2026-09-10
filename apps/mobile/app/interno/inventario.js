import { CapabilityBoundary } from "../../src/components/CapabilityBoundary";
import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";

export default function InternalInventoryScreen() {
  return (
    <CapabilityBoundary destination="inventory">
      <PlaceholderScreen
        title="Inventario"
        description="Stock, necesidades, reservas y movimientos estarán disponibles en una próxima etapa."
        productShell
      />
    </CapabilityBoundary>
  );
}
