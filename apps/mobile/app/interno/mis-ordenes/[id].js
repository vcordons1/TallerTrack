import { CapabilityBoundary } from "../../../src/components/CapabilityBoundary";
import { RealOrderDetailScreen } from "../../../src/features/orders/RealOrderDetailScreen";

const { CAPABILITIES } = require("../../../src/navigation/accessPolicy");

// The technical projection is explicit here, also for users that hold R and M.
export default function MyOrderDetailRoute() {
  return (
    <CapabilityBoundary capability={CAPABILITIES.TECHNICAL_ORDERS}>
      <RealOrderDetailScreen view="TECNICA" listRoute="/interno/mis-ordenes" listLabel="Mis órdenes" />
    </CapabilityBoundary>
  );
}
