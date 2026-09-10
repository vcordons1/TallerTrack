export function createOraclePoolManager({ driver, config }) {
  let pool;
  let initialization;
  let closing;

  async function initialize() {
    if (closing !== undefined) throw new Error("Oracle pool manager is closing or closed");
    if (pool !== undefined) return pool;
    if (initialization !== undefined) return initialization;

    initialization = driver.createPool({
      user: config.user,
      password: config.password,
      connectString: config.connectString,
      poolMin: config.poolMin,
      poolMax: config.poolMax,
      poolIncrement: config.poolIncrement,
      queueTimeout: config.queueTimeout,
      poolTimeout: config.poolTimeout,
    }).then((createdPool) => {
      pool = createdPool;
      return createdPool;
    });

    try {
      return await initialization;
    } catch (error) {
      initialization = undefined;
      throw error;
    }
  }

  async function getConnection() {
    if (pool === undefined) throw new Error("Oracle pool has not been initialized");
    return pool.getConnection();
  }

  async function withConnection(operation) {
    const connection = await getConnection();
    try {
      return await operation(connection);
    } finally {
      await connection.close();
    }
  }

  async function close() {
    if (closing !== undefined) return closing;
    closing = (async () => {
      if (initialization !== undefined) {
        try { await initialization; } catch { return; }
      }
      if (pool === undefined) return;
      const poolToClose = pool;
      pool = undefined;
      initialization = undefined;
      await poolToClose.close(10);
    })();
    return closing;
  }

  return Object.freeze({ initialize, getConnection, withConnection, close });
}
