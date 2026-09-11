import oracledb from "oracledb";

const ORACLE_IDENTIFIER = /^[A-Z][A-Z0-9_$#]{0,29}$/;

function timestamp(date) {
  return date.toISOString().replace("Z", "+00:00");
}

function asBuffer(hex) {
  return Buffer.from(hex, "hex");
}

function parseAccess(outBinds) {
  if (outBinds.valid !== 1) return null;
  return Object.freeze({
    userId: outBinds.userId,
    sessionId: outBinds.sessionId,
    type: outBinds.type,
    clientId: outBinds.clientId ?? null,
    displayName: outBinds.displayName,
    roles: Object.freeze(JSON.parse(outBinds.rolesJson)),
    sessionExpiresAt: outBinds.sessionExpiresAt,
  });
}

function mapOracleError(error) {
  const match = /ORA-20\d{3}:\s*([A-Z_]+)/.exec(error?.message ?? "");
  if (match !== null) error.code = match[1];
  return error;
}

export function createOracleIdentityRepository({ poolManager, schema, driver = oracledb }) {
  if (!poolManager || typeof poolManager.getConnection !== "function"
    || typeof schema !== "string" || !ORACLE_IDENTIFIER.test(schema)) {
    throw new TypeError("Identity repository dependencies are invalid");
  }
  const outString = (maxSize) => ({ dir: driver.BIND_OUT, type: driver.STRING, maxSize });
  const outNumber = { dir: driver.BIND_OUT, type: driver.NUMBER };
  const outBuffer = { dir: driver.BIND_OUT, type: driver.BUFFER, maxSize: 16 };

  async function execute(connection, sql, binds) {
    try {
      return await connection.execute(sql, binds, { autoCommit: false });
    } catch (error) {
      throw mapOracleError(error);
    }
  }

  async function withTransaction(operation) {
    const connection = await poolManager.getConnection();
    let committed = false;
    try {
      const result = await operation(connection);
      await connection.commit();
      committed = true;
      return result;
    } catch (error) {
      if (!committed) {
        try { await connection.rollback(); } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Identity operation and rollback both failed");
        }
      }
      throw error;
    } finally {
      await connection.close();
    }
  }

  async function validateOn(connection, claims) {
    const result = await execute(connection, `BEGIN ${schema}.pkg_identidad.validar_sesion(
      :userId, :sessionIdentifier, :credentialVersion, :valid, :sessionId,
      :type, :clientId, :displayName, :rolesJson, :sessionExpiresAt
    ); END;`, {
      userId: claims.userId,
      sessionIdentifier: asBuffer(claims.sessionIdentifier),
      credentialVersion: claims.credentialVersion,
      valid: outNumber,
      sessionId: outString(40),
      type: outString(10),
      clientId: outString(40),
      displayName: outString(200),
      rolesJson: outString(1000),
      sessionExpiresAt: outString(40),
    });
    return parseAccess({ ...result.outBinds, userId: String(claims.userId) });
  }

  return Object.freeze({
    async findInternalCredential(login) {
      return poolManager.withConnection(async (connection) => {
        const result = await execute(connection, `BEGIN ${schema}.pkg_identidad.buscar_credencial_interna(
          :login, :found, :userId, :displayName, :passwordHash, :credentialVersion, :active
        ); END;`, {
          login,
          found: outNumber,
          userId: outString(40),
          displayName: outString(200),
          passwordHash: outString(1000),
          credentialVersion: outString(20),
          active: outNumber,
        });
        if (result.outBinds.found !== 1) return null;
        return Object.freeze(result.outBinds);
      });
    },

    createSession({ userId, credentialVersion, sessionIdentifier, sessionExpiresAt,
      device, refreshHash, refreshExpiresAt }) {
      return withTransaction(async (connection) => {
        const result = await execute(connection, `BEGIN ${schema}.pkg_identidad.crear_sesion_interna(
          :userId, :credentialVersion, :sessionIdentifier,
          TO_TIMESTAMP_TZ(:sessionExpiresAt, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM'),
          :device, :refreshHash,
          TO_TIMESTAMP_TZ(:refreshExpiresAt, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM'),
          :sessionId
        ); END;`, {
          userId,
          credentialVersion,
          sessionIdentifier: asBuffer(sessionIdentifier),
          sessionExpiresAt: timestamp(sessionExpiresAt),
          device,
          refreshHash,
          refreshExpiresAt: timestamp(refreshExpiresAt),
          sessionId: outString(40),
        });
        const access = await validateOn(connection, { userId, sessionIdentifier, credentialVersion });
        if (access === null) throw new Error("Created session could not be validated");
        return Object.freeze({ ...access, sessionId: result.outBinds.sessionId });
      });
    },

    validateSession(claims) {
      return poolManager.withConnection((connection) => validateOn(connection, claims));
    },

    rotateRefresh({ refreshHash, successorHash, successorExpiresAt, correlationId }) {
      return withTransaction(async (connection) => {
        const result = await execute(connection, `BEGIN ${schema}.pkg_identidad.rotar_refresh(
          :refreshHash, :successorHash,
          TO_TIMESTAMP_TZ(:successorExpiresAt, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM'),
          :outcome, :userId, :sessionId, :sessionIdentifier,
          :credentialVersion, :sessionExpiresAt, :correlationId
        ); END;`, {
          refreshHash,
          successorHash,
          successorExpiresAt: timestamp(successorExpiresAt),
          outcome: outString(20),
          userId: outString(40),
          sessionId: outString(40),
          sessionIdentifier: outBuffer,
          credentialVersion: outString(20),
          sessionExpiresAt: outString(40),
          correlationId,
        });
        return Object.freeze({
          ...result.outBinds,
          sessionIdentifier: result.outBinds.sessionIdentifier?.toString("hex"),
        });
      });
    },

    revokeSession({ userId, sessionIdentifier, credentialVersion, correlationId }) {
      return withTransaction(async (connection) => {
        const result = await execute(connection, `BEGIN ${schema}.pkg_identidad.revocar_sesion(
          :userId, :sessionIdentifier, :credentialVersion, :correlationId, :revoked
        ); END;`, {
          userId,
          sessionIdentifier: asBuffer(sessionIdentifier),
          credentialVersion,
          correlationId,
          revoked: outNumber,
        });
        return result.outBinds.revoked === 1;
      });
    },
  });
}
