import { Redirect } from "expo-router";

import { useSession } from "../session/SessionProvider";

const {
  canAccessInternalDestination,
  hasInternalCapability,
} = require("../navigation/accessPolicy");

export function CapabilityBoundary({ capability, destination, children }) {
  const { access } = useSession();
  const allowed = capability
    ? hasInternalCapability(access?.roles, capability)
    : canAccessInternalDestination(access?.roles, destination);

  if (!allowed) {
    return <Redirect href="/interno" />;
  }

  return children;
}
