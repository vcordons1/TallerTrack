import { api } from "../../api/runtime";

function query(path, params) {
  const url = new URLSearchParams(params);
  return `${path}?${url.toString()}`;
}

export const receptionRepository = Object.freeze({
  async searchCustomers(search) {
    return (await api.request(query("/interno/clientes", { q: search.trim(), activo: "true", limite: "25" }))).data;
  },
  async listVehicles(customerId, cursor) {
    const params = { clienteId: customerId, activo: "true", limite: "25" };
    if (cursor) params.cursor = cursor;
    const result = await api.request(query("/interno/vehiculos", params));
    return { vehicles: result.data, cursor: result.page?.siguienteCursor || null };
  },
  async getVehicle(id) { return (await api.request(`/interno/vehiculos/${encodeURIComponent(id)}`)).data; },
  async upload(photo, context) {
    const form = new FormData();
    form.append("contexto", JSON.stringify({ tipo: "RECEPCION_PREVIA", ...context }));
    form.append("archivo", { uri: photo.uri, name: "recepcion.jpg", type: photo.mimeType || "image/jpeg" });
    return (await api.request("/interno/evidencias/cargar", { method: "POST", body: form })).data.recibo;
  },
  async open(body, key) {
    return (await api.request("/interno/ordenes/abrir", {
      method: "POST", body, headers: { "Idempotency-Key": key },
    })).data;
  },
  async getOrder(id) { return (await api.request(`/interno/ordenes/${encodeURIComponent(id)}?vista=RECEPCION`)).data; },
});
