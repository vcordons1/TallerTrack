import { CapabilityBoundary } from "../../../src/components/CapabilityBoundary";
import { OrderDetailScreen } from "../../../src/features/orders/OrderDetailScreen";
import { RealOrderDetailScreen } from "../../../src/features/orders/RealOrderDetailScreen";
import { useSession } from "../../../src/session/SessionProvider";

const { CAPABILITIES } = require("../../../src/navigation/accessPolicy");

export default function InternalOrderDetailRoute() {
  const { access } = useSession();
  return (
    <CapabilityBoundary capability={CAPABILITIES.ORDERS_READ}>
      {access.roles.includes("RECEPCIONISTA") || access.roles.includes("MECANICO")
        ? <RealOrderDetailScreen /> : <OrderDetailScreen />}
    </CapabilityBoundary>
  );
}
