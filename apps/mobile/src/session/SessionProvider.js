import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
} from "react";

import { api, setSessionHandlers } from "../api/runtime";

const {
  initialSessionState,
  sessionReducer,
} = require("./sessionState");

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);

  const reloadIdentity = useCallback(async () => {
    const access = await api.identity();
    dispatch({ type: "SESSION_RESOLVED", access });
    return access;
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      if (!(await api.restore())) {
        dispatch({ type: "SESSION_CLEARED" });
        return;
      }
      await reloadIdentity();
    } catch {
      if (api.hasTokens) dispatch({ type: "SESSION_ERROR" });
      else dispatch({ type: "SESSION_CLEARED" });
    }
  }, [reloadIdentity]);

  useEffect(() => {
    void bootstrap();
    return setSessionHandlers({
      lost: () => dispatch({ type: "SESSION_CLEARED" }),
      forbidden: () => { void reloadIdentity().catch(() => {}); },
    });
  }, [bootstrap, reloadIdentity]);

  const value = useMemo(
    () => ({
      ...state,
      login: async (login, password) => {
        await api.login(login, password);
        try { return await reloadIdentity(); }
        catch (error) { await api.clear(); throw error; }
      },
      logout: () => api.logout(),
      retrySession: bootstrap,
      clearSession: () => api.clear(),
    }),
    [state, bootstrap, reloadIdentity],
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
