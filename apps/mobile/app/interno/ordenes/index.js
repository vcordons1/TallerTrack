import { CapabilityBoundary } from "../../../src/components/CapabilityBoundary";
import { OrderListScreen } from "../../../src/features/orders/OrderListScreen";
import { realOrderRepository } from "../../../src/features/orders/realOrderRepository";
import { useSession } from "../../../src/session/SessionProvider";

const { CAPABILITIES } = require("../../../src/navigation/accessPolicy");

export default function InternalOrdersScreen() {
  const { access } = useSession();
  const reception = access.roles.includes("RECEPCIONISTA");
  const mechanic = access.roles.includes("MECANICO");
  return (
    <CapabilityBoundary capability={CAPABILITIES.ORDERS_READ}>
      <OrderListScreen repository={reception || mechanic ? realOrderRepository : undefined}
        realReception={reception} realTechnical={mechanic && !reception} />
    </CapabilityBoundary>
  );
}
