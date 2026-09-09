import { CapabilityBoundary } from "../../src/components/CapabilityBoundary";
import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";

export default function InternalInventoryScreen() {
  return (
    <CapabilityBoundary destination="inventory">
      <PlaceholderScreen
        eyebrow="Espacio interno"
        title="Inventario"
        description="Base reservada para stock, necesidades, reservas y movimientos de Inventario."
      />
    </CapabilityBoundary>
  );
}
