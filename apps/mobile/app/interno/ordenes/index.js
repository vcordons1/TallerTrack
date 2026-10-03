import { Redirect } from "expo-router";

import { CapabilityBoundary } from "../../../src/components/CapabilityBoundary";
import { OrderListScreen } from "../../../src/features/orders/OrderListScreen";
import { realOrderRepository } from "../../../src/features/orders/realOrderRepository";
import { useSession } from "../../../src/session/SessionProvider";

const { CAPABILITIES } = require("../../../src/navigation/accessPolicy");

export default function InternalOrdersScreen() {
  const { access } = useSession();
  const reception = access.roles.includes("RECEPCIONISTA");
  // A pure mechanic has no reception queue: its orders live in "Mis órdenes".
  if (access.roles.length > 0 && access.roles.every((role) => role === "MECANICO")) {
    return <Redirect href="/interno/mis-ordenes" />;
  }
  return (
    <CapabilityBoundary capability={CAPABILITIES.ORDERS_READ}>
      <OrderListScreen repository={reception ? realOrderRepository : undefined} realReception={reception} />
    </CapabilityBoundary>
  );
}
