import { Redirect } from "expo-router";

import { useSession } from "../session/SessionProvider";
import { SessionLoading } from "./SessionLoading";

const { ACTOR_TYPES } = require("../navigation/accessPolicy");
const { SESSION_STATUS } = require("../session/sessionState");

export function ActorBoundary({ actorType, children }) {
  const session = useSession();

  if (session.status === SESSION_STATUS.LOADING) {
    return <SessionLoading />;
  }

  if (session.status === SESSION_STATUS.UNAUTHENTICATED) {
    return <Redirect href="/acceso/iniciar-sesion" />;
  }

  if (session.access.tipoActor !== actorType) {
    const destination =
      session.access.tipoActor === ACTOR_TYPES.INTERNAL
        ? "/interno"
        : "/cliente";
    return <Redirect href={destination} />;
  }

  return children;
}
