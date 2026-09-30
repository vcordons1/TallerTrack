import { api } from "../../api/runtime";

export const realOrderRepository = Object.freeze({
  async loadPage(view, cursor) {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const result = await api.request(`/interno/ordenes?vista=${encodeURIComponent(view)}&limite=25${suffix}`);
    return { orders: result.data, cursor: result.page?.siguienteCursor || null };
  },
  async loadDetail(id, view) {
    return (await api.request(`/interno/ordenes/${encodeURIComponent(id)}?vista=${encodeURIComponent(view)}`)).data;
  },
  async loadParticipants(id, cursor) {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    return api.request(`/interno/ordenes/${encodeURIComponent(id)}/mecanicos?limite=100${suffix}`);
  },
  async loadEligibleMechanics(id, cursor) {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    return api.request(`/interno/mecanicos?ordenId=${encodeURIComponent(id)}&limite=100${suffix}`);
  },
  async loadWorks(id, cursor) {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    return api.request(`/interno/ordenes/${encodeURIComponent(id)}/trabajos?limite=100${suffix}`);
  },
  async loadDiagnoses(id, cursor) {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    return api.request(`/interno/ordenes/${encodeURIComponent(id)}/diagnosticos?limite=100${suffix}`);
  },
  async assignMechanic(id, mechanicId, key) {
    return api.request(`/interno/ordenes/${encodeURIComponent(id)}/asignar-mecanico`, {
      method: "POST", body: { mecanicoId: mechanicId, motivo: "Asignación para diagnóstico" },
      headers: { "Idempotency-Key": key }, uncertainBusinessResult: true,
    });
  },
  async proposeFreeDiagnosis(id, description, key) {
    return api.request(`/interno/ordenes/${encodeURIComponent(id)}/trabajos`, {
      method: "POST", body: { tipo: "DIAGNOSTICO", tipoServicio: "DIAGNOSTICO",
        descripcion: description, diagnosticoGratuito: true },
      headers: { "Idempotency-Key": key }, uncertainBusinessResult: true,
    });
  },
  async startFreeDiagnosis(id, workId, version, key) {
    return api.request(`/interno/ordenes/${encodeURIComponent(id)}/trabajos/${encodeURIComponent(workId)}/iniciar`, {
      method: "POST", body: { versionEsperada: version, motivo: "Inicio de diagnóstico gratuito" },
      headers: { "Idempotency-Key": key }, uncertainBusinessResult: true,
    });
  },
  async confirmDiagnosis(id, workId, detail, summary, key) {
    return api.request(`/interno/ordenes/${encodeURIComponent(id)}/diagnosticos/confirmar`, {
      method: "POST", body: { trabajoDiagnosticoId: workId, detalleTecnico: detail,
        resumenCliente: summary },
      headers: { "Idempotency-Key": key }, uncertainBusinessResult: true,
    });
  },
});
