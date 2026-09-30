function createFreeDiagnosticFlow({ uuid }) {
  let pending = null;
  let sending = false;
  return Object.freeze({
    async run(kind, action) {
      if (sending) throw new Error("El comando ya está enviándose.");
      if (pending && pending.kind !== kind) throw new Error("Verifica primero el resultado pendiente.");
      const command = pending || { kind, key: uuid(), action };
      pending = command;
      sending = true;
      try {
        const result = await command.action(command.key);
        pending = null;
        return result;
      } catch (error) {
        if (!error.uncertain) pending = null;
        throw error;
      } finally {
        sending = false;
      }
    },
    get pending() { return pending; },
  });
}

module.exports = { createFreeDiagnosticFlow };
