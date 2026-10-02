import { api } from "../../api/runtime";

function query(path, params) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(name, String(value));
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

const id = (value) => encodeURIComponent(value);

// Reads (L) and versioned edits (V). K commands go through createCommandIntent instead,
// because they need a retained Idempotency-Key.
export const customerVehicleRepository = Object.freeze({
  async listCustomers({ q, activo, cursor, limite = 25 } = {}) {
    return api.request(query("/interno/clientes", { q, activo, cursor, limite }));
  },
  async getCustomer(customerId) {
    return (await api.request(`/interno/clientes/${id(customerId)}`)).data;
  },
  async updateCustomer(customerId, versionEsperada, cambios) {
    return (await api.request(`/interno/clientes/${id(customerId)}`, { method: "PATCH",
      body: { versionEsperada, cambios }, uncertainBusinessResult: true })).data;
  },
  async listVehicles({ q, clienteId, activo, cursor, limite = 25 } = {}) {
    return api.request(query("/interno/vehiculos", { q, clienteId, activo, cursor, limite }));
  },
  async getVehicle(vehicleId) {
    return (await api.request(`/interno/vehiculos/${id(vehicleId)}`)).data;
  },
  async updateVehicle(vehicleId, versionEsperada, cambios) {
    return (await api.request(`/interno/vehiculos/${id(vehicleId)}`, { method: "PATCH",
      body: { versionEsperada, cambios }, uncertainBusinessResult: true })).data;
  },
  async listProperties(vehicleId, cursor) {
    return api.request(query(`/interno/vehiculos/${id(vehicleId)}/propiedades`, { cursor, limite: 25 }));
  },
  async listVehicleTypes() {
    return (await api.request("/interno/tipos-vehiculo")).data;
  },
});
