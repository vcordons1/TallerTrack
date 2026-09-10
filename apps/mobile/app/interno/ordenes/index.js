import { CapabilityBoundary } from "../../../src/components/CapabilityBoundary";
import { OrderListScreen } from "../../../src/features/orders/OrderListScreen";

const { CAPABILITIES } = require("../../../src/navigation/accessPolicy");

export default function InternalOrdersScreen() {
  return (
    <CapabilityBoundary capability={CAPABILITIES.ORDERS_READ}>
      <OrderListScreen />
    </CapabilityBoundary>
  );
}
