import { createHash, randomBytes } from "node:crypto";

import oracledb from "oracledb";

const IDENTIFIER = /^[A-Z][A-Z0-9_$#]{0,29}$/;
const FACADE_ERROR = /ORA-20\d{3}:\s*([A-Z_]+)(?:\s+(\/[A-Za-z/]+))?/;
const FIELD_MESSAGES = Object.freeze({
  REFERENCIA_DUPLICADA: "Ya existe un registro con este identificador.",
  VALIDACION_DOMINIO: "El valor no cumple las condiciones vigentes.",
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestHash(material) {
  return createHash("sha256").update(canonical(material)).digest();
}

// Facade errors may carry a JSON Pointer naming the input field (e.g. a duplicated plate).
function mapFacadeError(error) {
  const match = FACADE_ERROR.exec(error?.message ?? "");
  if (match !== null) {
    error.code = match[1];
    if (match[2] !== undefined) {
      error.fields = [{ path: match[2], code: match[1], message: FIELD_MESSAGES[match[1]] ?? "Valor no válido." }];
    }
  }
  return error;
}

export function createOracleCustomerVehicleCommands({
  poolManager, schema, qrPublicBaseUrl, driver = oracledb, randomSecret = () => randomBytes(32),
}) {
  if (!poolManager || typeof poolManager.getConnection !== "function"
    || typeof schema !== "string" || !IDENTIFIER.test(schema)
    || typeof qrPublicBaseUrl !== "string" || qrPublicBaseUrl === "") {
    throw new TypeError("Customer/vehicle command dependencies are invalid");
  }
  const facade = `${schema}.pkg_clientes_vehiculos_http`;
  const outString = (maxSize) => ({ dir: driver.BIND_OUT, type: driver.STRING, maxSize });
  const commandOuts = () => ({ result: outString(4000), repeated: { dir: driver.BIND_OUT, type: driver.NUMBER },
    commandId: outString(40), confirmedAt: outString(40) });

  async function transaction(sql, binds) {
    const connection = await poolManager.getConnection();
    let committed = false;
    try {
      const executed = await connection.execute(sql, binds, { autoCommit: false });
      await connection.commit();
      committed = true;
      return executed.outBinds;
    } catch (error) {
      if (!committed) await connection.rollback();
      throw mapFacadeError(error);
    } finally { await connection.close(); }
  }

  async function command(procedure, names, binds) {
    const outBinds = await transaction(`BEGIN ${facade}.${procedure}(${names.map((name) => `:${name}`).join(",")},
      :result,:repeated,:commandId,:confirmedAt); END;`, { ...binds, ...commandOuts() });
    return { data: JSON.parse(outBinds.result), repeated: outBinds.repeated === 1,
      commandId: outBinds.commandId, confirmedAt: outBinds.confirmedAt };
  }

  // The QR secret is 32 random bytes (base64url, 43 chars). Only its SHA-256 reaches Oracle;
  // the URL exists solely in the first successful response and never in COMANDO or logs.
  function newQrSecret() {
    const secret = randomSecret();
    return { token: secret.toString("base64url"), hash: createHash("sha256").update(secret).digest() };
  }

  function withEmission(stored, repeated, token) {
    const { qrId: _qrId, ...data } = stored;
    return {
      ...data,
      emisionQr: repeated ? null : {
        generacionId: stored.qr.generacionId,
        urlPublica: `${qrPublicBaseUrl}/qr/${token}`,
        emitidoEn: stored.qr.emitidoEn,
        expiraEn: stored.qr.expiraEn,
      },
      requiereNuevaEmision: repeated,
    };
  }

  return Object.freeze({
    async registerCustomer({ actorId, sessionId, key, correlationId, profile }) {
      return command("registrar_cliente",
        ["actor", "session", "key", "hash", "correlation", "name", "phone", "email", "address", "nit"], {
          actor: actorId, session: sessionId, key, hash: requestHash({ operation: "C02", profile }),
          correlation: correlationId, name: profile.nombre, phone: profile.telefono,
          email: profile.email, address: profile.direccion, nit: profile.nit,
        });
    },

    async updateCustomer({ actorId, sessionId, correlationId, customerId, version, changes }) {
      const outBinds = await transaction(`BEGIN ${facade}.actualizar_cliente(
        :actor,:session,:correlation,:id,:version,:changes,:newVersion); END;`, {
        actor: actorId, session: sessionId, correlation: correlationId, id: customerId,
        version: Number(version), changes: JSON.stringify(changes), newVersion: outString(20),
      });
      return outBinds.newVersion;
    },

    async deactivate({ operation, actorId, sessionId, key, correlationId, id, version, reason }) {
      if (operation !== "C05" && operation !== "V07") throw new TypeError("Unknown deactivation");
      return command("desactivar",
        ["operation", "actor", "session", "key", "hash", "correlation", "id", "version", "reason"], {
          operation, actor: actorId, session: sessionId, key,
          hash: requestHash({ operation, id, version, reason }), correlation: correlationId,
          id, version: Number(version), reason,
        });
    },

    async registerVehicle({ actorId, sessionId, key, correlationId, vehicle, ownerId, reason }) {
      const qr = newQrSecret();
      const result = await command("registrar_vehiculo",
        ["actor", "session", "key", "hash", "correlation", "ownerId", "type", "plate", "vin",
          "brand", "model", "year", "color", "reason", "tokenHash"], {
          actor: actorId, session: sessionId, key,
          hash: requestHash({ operation: "V02", vehicle, ownerId, reason }), correlation: correlationId,
          ownerId, type: vehicle.tipoVehiculo, plate: vehicle.placa, vin: vehicle.vin,
          brand: vehicle.marca, model: vehicle.modelo, year: vehicle.anio, color: vehicle.color,
          reason, tokenHash: qr.hash,
        });
      return { ...result, data: withEmission(result.data, result.repeated, qr.token) };
    },

    async updateVehicle({ actorId, sessionId, correlationId, vehicleId, version, changes }) {
      const outBinds = await transaction(`BEGIN ${facade}.actualizar_vehiculo(
        :actor,:session,:correlation,:id,:version,:changes,:newVersion); END;`, {
        actor: actorId, session: sessionId, correlation: correlationId, id: vehicleId,
        version: Number(version), changes: JSON.stringify(changes), newVersion: outString(20),
      });
      return outBinds.newVersion;
    },

    async transferOwner({ actorId, sessionId, key, correlationId, vehicleId, transfer }) {
      const qr = newQrSecret();
      const result = await command("transferir_propietario",
        ["actor", "session", "key", "hash", "correlation", "vehicleId", "expectedProperty",
          "expectedOwner", "newOwner", "reason", "tokenHash"], {
          actor: actorId, session: sessionId, key,
          hash: requestHash({ operation: "V06", vehicleId, ...transfer }), correlation: correlationId,
          vehicleId, expectedProperty: transfer.expectedPropertyId, expectedOwner: transfer.expectedOwnerId,
          newOwner: transfer.newOwnerId, reason: transfer.reason, tokenHash: qr.hash,
        });
      return { ...result, data: withEmission(result.data, result.repeated, qr.token) };
    },
  });
}
