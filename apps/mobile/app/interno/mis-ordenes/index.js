import { CapabilityBoundary } from "../../../src/components/CapabilityBoundary";
import { OrderListScreen } from "../../../src/features/orders/OrderListScreen";
import { realOrderRepository } from "../../../src/features/orders/realOrderRepository";

const { CAPABILITIES } = require("../../../src/navigation/accessPolicy");

// O01 vista=TECNICA: only orders where this mechanic has a current participation.
export default function MyOrdersScreen() {
  return (
    <CapabilityBoundary capability={CAPABILITIES.TECHNICAL_ORDERS}>
      <OrderListScreen repository={realOrderRepository} realTechnical />
    </CapabilityBoundary>
  );
}
