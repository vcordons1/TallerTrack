import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";

import { api, setSessionHandlers } from "../api/runtime";
import { AppState } from "react-native";
import { usePathname } from "expo-router";

const {
  initialSessionState,
  sessionReducer,
} = require("./sessionState");

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const pathname = usePathname();
  const identityRequest = useRef(0);

  const reloadIdentity = useCallback(async () => {
    const request = ++identityRequest.current;
    const access = await api.identity();
    if (request === identityRequest.current && api.hasTokens) dispatch({ type: "SESSION_RESOLVED", access });
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

  useEffect(() => {
    if (api.hasTokens) void reloadIdentity().catch(() => {});
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && api.hasTokens) void reloadIdentity().catch(() => {});
    });
    return () => subscription.remove();
  }, [pathname, reloadIdentity]);

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
      refreshIdentity: reloadIdentity,
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
