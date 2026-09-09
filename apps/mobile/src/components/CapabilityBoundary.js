import { Redirect } from "expo-router";

import { useSession } from "../session/SessionProvider";

const {
  canAccessInternalDestination,
} = require("../navigation/accessPolicy");

export function CapabilityBoundary({ destination, children }) {
  const { access } = useSession();

  if (!canAccessInternalDestination(access?.roles, destination)) {
    return <Redirect href="/interno" />;
  }

  return children;
}
