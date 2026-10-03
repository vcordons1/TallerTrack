import { api } from "../../api/runtime";

const { orderListQuery } = require("./orderListQuery.cjs");

function page(cursor) {
  return cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
}

export const realOrderRepository = Object.freeze({
  async loadPage(view, cursor, filters = {}) {
    const result = await api.request(`/interno/ordenes?${orderListQuery(view, cursor, filters)}`);
    return { orders: result.data, cursor: result.page?.siguienteCursor || null };
  },
  async loadDetail(id, view) {
    return (await api.request(`/interno/ordenes/${encodeURIComponent(id)}?vista=${encodeURIComponent(view)}`)).data;
  },
  // O05 keeps current and retired participations.
  async loadParticipants(id, cursor) {
    return api.request(`/interno/ordenes/${encodeURIComponent(id)}/mecanicos?limite=100${page(cursor)}`);
  },
  // I15 is scoped to the order; the server filters by name (q).
  async searchEligibleMechanics(id, q, cursor) {
    const text = q?.trim() ? `&q=${encodeURIComponent(q.trim())}` : "";
    return api.request(`/interno/mecanicos?ordenId=${encodeURIComponent(id)}&limite=50${text}${page(cursor)}`);
  },
  // TT-024 free-diagnostic reads/commands, kept for TT-029 (see FreeDiagnosticSection.js).
  async loadWorks(id, cursor) {
    return api.request(`/interno/ordenes/${encodeURIComponent(id)}/trabajos?limite=100${page(cursor)}`);
  },
  async loadDiagnoses(id, cursor) {
    return api.request(`/interno/ordenes/${encodeURIComponent(id)}/diagnosticos?limite=100${page(cursor)}`);
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
