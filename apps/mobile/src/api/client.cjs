const ACCESS_FAILURES = new Set(["ACCESO_EXPIRADO", "SESION_INVALIDA"]);

class ApiError extends Error {
  constructor(message, { status = 0, code = null, requestId = null, recovery = null, uncertain = false } = {}) {
    super(message);
    this.name = "ApiError";
    Object.assign(this, { status, code, requestId, recovery, uncertain });
  }
}

function createApiClient({ baseUrl, fetchImpl, store, onSessionLost = () => {}, onForbidden = () => {}, timeoutMs = 20000 }) {
  const configured = /^https?:\/\/[^/]+\/api\/v1\/?$/.test(baseUrl || "");
  let tokens = null;
  let refreshFlight = null;
  let generation = 0;

  async function clear() {
    generation += 1;
    tokens = null;
    await store.clear();
    onSessionLost();
  }

  async function save(next) {
    const saved = { accessToken: next.accessToken, refreshToken: next.refreshToken };
    await store.write(saved);
    tokens = saved;
  }

  async function raw(path, { method = "GET", body, headers = {}, authenticated = true } = {}, token) {
    if (!configured) throw new ApiError("Configura EXPO_PUBLIC_API_BASE_URL con la URL /api/v1 de la laptop.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: {
          ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body != null && !(typeof FormData !== "undefined" && body instanceof FormData)
            ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body == null ? undefined :
          (typeof FormData !== "undefined" && body instanceof FormData ? body : JSON.stringify(body)),
        signal: controller.signal,
      });
      if (response.status === 204) return null;
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const error = payload?.error;
        throw new ApiError(error?.message || "No se pudo completar la solicitud.", {
          status: response.status, code: error?.code,
          requestId: error?.requestId || response.headers?.get?.("X-Request-ID"),
          recovery: error?.recuperacion,
          uncertain: error?.resultado === "DESCONOCIDO" || error?.recuperacion === "REINTENTAR_MISMA_CLAVE",
        });
      }
      if (!payload || typeof payload !== "object" || !Object.hasOwn(payload, "data")) {
        throw new ApiError("El servidor devolvió una respuesta inesperada.", { status: response.status });
      }
      return payload;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("No se pudo conectar con TallerTrack. Comprueba la red y vuelve a intentar.", {
        uncertain: method !== "GET",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh() {
    if (refreshFlight) return refreshFlight;
    if (!tokens?.refreshToken) { await clear(); throw new ApiError("La sesión terminó. Inicia sesión nuevamente.", { status: 401 }); }
    const currentGeneration = generation;
    refreshFlight = (async () => {
      try {
        const response = await raw("/acceso/sesiones/renovar", {
          method: "POST", body: { refreshToken: tokens.refreshToken }, authenticated: false,
        });
        if (generation !== currentGeneration) throw new ApiError("La sesión terminó.", { status: 401 });
        await save(response.data);
      } catch (error) {
        // A lost rotation response has an unknown successor. The old token is no longer safe to reuse.
        if (generation === currentGeneration) await clear();
        throw error;
      }
    })();
    try { await refreshFlight; } finally { refreshFlight = null; }
  }

  async function request(path, options = {}) {
    if (options.authenticated !== false && !tokens) throw new ApiError("Inicia sesión nuevamente.", { status: 401 });
    const usedToken = tokens?.accessToken;
    try {
      return await raw(path, options, usedToken);
    } catch (error) {
      if (options.authenticated !== false && error.status === 401 && ACCESS_FAILURES.has(error.code)) {
        if (tokens?.accessToken === usedToken) await refresh();
        return raw(path, options, tokens?.accessToken).catch(async (retryError) => {
          if (retryError.status === 401) await clear();
          if (retryError.status === 403) onForbidden();
          throw retryError;
        });
      }
      if (error.status === 403) onForbidden();
      throw error;
    }
  }

  return Object.freeze({
    request,
    async restore() { tokens = await store.read(); return tokens !== null; },
    async login(login, password) {
      const response = await request("/acceso/sesiones", {
        method: "POST", body: { login, password }, authenticated: false,
      });
      await save(response.data.tokens);
      return response.data.acceso;
    },
    async identity() { return (await request("/acceso/yo")).data; },
    async logout() {
      const access = tokens?.accessToken;
      await clear();
      if (access) {
        try { await raw("/acceso/sesiones/cerrar", { method: "POST", body: {} }, access); }
        catch { /* Local logout is final even when the laptop is unreachable. */ }
      }
    },
    clear,
    get hasTokens() { return tokens !== null; },
  });
}

module.exports = { ApiError, createApiClient };
