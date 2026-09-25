import oracledb from "oracledb";

const ORACLE_IDENTIFIER = /^[A-Z][A-Z0-9_$#]{0,29}$/;

export function mapOracleQueryError(error) {
  const match = /ORA-20\d{3}:\s*([A-Z_]+)/.exec(error?.message ?? "");
  if (match !== null) error.code = match[1];
  return error;
}

export function createOracleQueryExecutor({ poolManager, schema, driver = oracledb }) {
  if (!poolManager || typeof poolManager.withConnection !== "function"
    || typeof schema !== "string" || !ORACLE_IDENTIFIER.test(schema)) {
    throw new TypeError("Oracle query dependencies are invalid");
  }
  return async function executeQuery(procedure, binds, maximumRows) {
    return poolManager.withConnection(async (connection) => {
      let cursor;
      try {
        const result = await connection.execute(
          `BEGIN ${schema}.${procedure}(${Object.keys(binds).map((name) => `:${name}`).join(",")}, :resultado); END;`,
          { ...binds, resultado: { dir: driver.BIND_OUT, type: driver.CURSOR } },
          { autoCommit: false, outFormat: driver.OUT_FORMAT_OBJECT },
        );
        cursor = result.outBinds.resultado;
        const rows = await cursor.getRows(maximumRows);
        return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value])));
      } catch (error) {
        throw mapOracleQueryError(error);
      } finally {
        if (cursor !== undefined) await cursor.close();
      }
    });
  };
}
