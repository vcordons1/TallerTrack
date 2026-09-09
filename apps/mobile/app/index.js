import { Redirect } from "expo-router";

import { SessionLoading } from "../src/components/SessionLoading";
import { useSession } from "../src/session/SessionProvider";

const { getAuthenticatedRoot } = require("../src/navigation/accessPolicy");
const { SESSION_STATUS } = require("../src/session/sessionState");

export default function RootIndex() {
  const session = useSession();

  if (session.status === SESSION_STATUS.LOADING) {
    return <SessionLoading />;
  }

  return <Redirect href={getAuthenticatedRoot(session.access)} />;
}
