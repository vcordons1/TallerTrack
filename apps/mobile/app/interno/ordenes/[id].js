import { CapabilityBoundary } from "../../../src/components/CapabilityBoundary";
import { OrderDetailScreen } from "../../../src/features/orders/OrderDetailScreen";
import { RealOrderDetailScreen } from "../../../src/features/orders/RealOrderDetailScreen";
import { useSession } from "../../../src/session/SessionProvider";

const { CAPABILITIES } = require("../../../src/navigation/accessPolicy");

export default function InternalOrderDetailRoute() {
  const { access } = useSession();
  return (
    <CapabilityBoundary capability={CAPABILITIES.ORDERS_READ}>
      {/* Real orders are never shown with demo data: A/R/M read O03. Only isolated
          INVENTARIO keeps its separate demo workspace until its real screens exist. */}
      {["ADMINISTRADOR", "RECEPCIONISTA", "MECANICO"].some((role) => access.roles.includes(role))
        ? <RealOrderDetailScreen /> : <OrderDetailScreen />}
    </CapabilityBoundary>
  );
}
