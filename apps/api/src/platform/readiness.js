const REQUIRED_ROLES = ["ADMINISTRADOR", "RECEPCIONISTA", "MECANICO", "INVENTARIO", "CLIENTE"];

export function createReadinessCheck({ poolManager, config }) {
  const migrationHistory = `${config.schema}."flyway_schema_history"`;
  const configurationTable = `${config.schema}.CONFIG_TALLER`;
  const roleTable = `${config.schema}.ROL`;
  const roleList = REQUIRED_ROLES.map((role) => `'${role}'`).join(", ");
  const sql = `
    SELECT
      SYS_CONTEXT('USERENV', 'CURRENT_USER'),
      SYS_CONTEXT('USERENV', 'DB_UNIQUE_NAME'),
      SYS_CONTEXT('USERENV', 'SERVICE_NAME'),
      (SELECT COUNT(DISTINCT LPAD("version", 3, '0'))
         FROM ${migrationHistory}
        WHERE LPAD("version", 3, '0') IN ('001', '002', '003', '004')
          AND "success" = 1),
      (SELECT COUNT(*) FROM ${configurationTable}
        WHERE ID_CONFIG = 1 AND MONEDA = 'GTQ' AND ZONA_HORARIA = 'America/Guatemala'),
      (SELECT COUNT(*) FROM ${roleTable} WHERE CODIGO_ROL IN (${roleList}))
    FROM DUAL`;

  return async function checkReadiness() {
    return poolManager.withConnection(async (connection) => {
      const result = await connection.execute(sql);
      const row = result.rows?.[0];
      return Array.isArray(row)
        && row[0] === config.user
        && row[1]?.toUpperCase() === config.expectedDatabase
        && row[2]?.toUpperCase() === config.expectedService
        && row[3] === 4
        && row[4] === 1
        && row[5] === REQUIRED_ROLES.length;
    });
  };
}
