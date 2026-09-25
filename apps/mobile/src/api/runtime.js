import { secureSessionStore } from "../session/sessionRepository";

const { createApiClient } = require("./client.cjs");

let lostHandler = () => {};
let forbiddenHandler = () => {};

export const api = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  fetchImpl: fetch,
  store: secureSessionStore,
  onSessionLost: () => lostHandler(),
  onForbidden: () => forbiddenHandler(),
});

export function setSessionHandlers({ lost, forbidden }) {
  lostHandler = lost;
  forbiddenHandler = forbidden;
  return () => { lostHandler = () => {}; forbiddenHandler = () => {}; };
}
