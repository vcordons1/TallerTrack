import { CapabilityBoundary } from "../../src/components/CapabilityBoundary";
import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";

export default function InternalOrdersScreen() {
  return (
    <CapabilityBoundary destination="orders">
      <PlaceholderScreen
        title="Órdenes"
        description="Las tareas de recepción, trabajo técnico y repuestos estarán disponibles según tus capacidades."
        productShell
      />
    </CapabilityBoundary>
  );
}
