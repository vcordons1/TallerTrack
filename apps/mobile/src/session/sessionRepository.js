import * as SecureStore from "expo-secure-store";

const KEY = "tallertrack.session.v1";

export const secureSessionStore = Object.freeze({
  async read() {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    try {
      const tokens = JSON.parse(raw);
      if (typeof tokens.accessToken === "string" && typeof tokens.refreshToken === "string") return tokens;
      await SecureStore.deleteItemAsync(KEY);
      return null;
    } catch {
      await SecureStore.deleteItemAsync(KEY);
      return null;
    }
  },
  async write(tokens) {
    await SecureStore.setItemAsync(KEY, JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }));
  },
  async clear() { await SecureStore.deleteItemAsync(KEY); },
});
