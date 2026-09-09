import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";

import { resolveInitialSession } from "./sessionRepository";

const {
  initialSessionState,
  sessionReducer,
} = require("./sessionState");

const SessionContext = createContext(null);

export function SessionProvider({ children, resolver = resolveInitialSession }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      let access = null;

      try {
        access = await resolver();
      } finally {
        if (active) {
          dispatch({ type: "SESSION_RESOLVED", access });
        }
      }
    }

    bootstrap();

    return () => {
      active = false;
    };
  }, [resolver]);

  const value = useMemo(
    () => ({
      ...state,
      clearSession: () => dispatch({ type: "SESSION_CLEARED" }),
    }),
    [state],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const session = useContext(SessionContext);

  if (!session) {
    throw new Error("useSession debe utilizarse dentro de SessionProvider.");
  }

  return session;
}
