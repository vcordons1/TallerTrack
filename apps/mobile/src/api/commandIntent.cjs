// One K intention (API contract §2.5/§2.6): the key and a frozen copy of the body are
// created once; an uncertain result keeps both so the only retry is the same intention.
function createCommandIntent({ request, uuid }) {
  let pending = null;
  let sending = false;
  return {
    get pending() { return pending !== null; },
    async run(path, body) {
      if (sending) throw new Error("La operación ya se está enviando.");
      pending ||= { path, body: JSON.parse(JSON.stringify(body)), key: uuid() };
      sending = true;
      try {
        const result = await request(pending.path, { method: "POST", body: pending.body,
          headers: { "Idempotency-Key": pending.key }, uncertainBusinessResult: true });
        pending = null;
        return result.data;
      } catch (error) {
        if (!error.uncertain) pending = null;
        throw error;
      } finally { sending = false; }
    },
  };
}

module.exports = { createCommandIntent };
