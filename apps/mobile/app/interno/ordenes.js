import { CapabilityBoundary } from "../../src/components/CapabilityBoundary";
import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";

export default function InternalOrdersScreen() {
  return (
    <CapabilityBoundary destination="orders">
      <PlaceholderScreen
        eyebrow="Espacio interno"
        title="Órdenes"
        description="Aquí se incorporarán las tareas permitidas de recepción, trabajo técnico o repuestos sin mezclar sus proyecciones."
      />
    </CapabilityBoundary>
  );
}
