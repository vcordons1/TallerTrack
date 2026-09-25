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
});
