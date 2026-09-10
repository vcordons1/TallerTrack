import { CapabilityBoundary } from "../../../src/components/CapabilityBoundary";
import { OrderDetailScreen } from "../../../src/features/orders/OrderDetailScreen";

const { CAPABILITIES } = require("../../../src/navigation/accessPolicy");

export default function InternalOrderDetailRoute() {
  return (
    <CapabilityBoundary capability={CAPABILITIES.ORDERS_READ}>
      <OrderDetailScreen />
    </CapabilityBoundary>
  );
}
