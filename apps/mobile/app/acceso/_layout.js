import { Redirect, Stack } from "expo-router";

import { SessionLoading } from "../../src/components/SessionLoading";
import { useSession } from "../../src/session/SessionProvider";

const { getAuthenticatedRoot } = require("../../src/navigation/accessPolicy");
const { SESSION_STATUS } = require("../../src/session/sessionState");

export default function AccessLayout() {
  const session = useSession();

  if (session.status === SESSION_STATUS.LOADING) {
    return <SessionLoading />;
  }

  if (session.status === SESSION_STATUS.AUTHENTICATED) {
    return <Redirect href={getAuthenticatedRoot(session.access)} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
