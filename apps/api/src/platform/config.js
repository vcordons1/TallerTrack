const ORACLE_IDENTIFIER = /^[A-Z][A-Z0-9_$#]{0,29}$/;

function requireValue(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Required environment variable ${name} is missing or empty`);
  }
  return value;
}

function readInteger(environment, name, defaultValue, { minimum, maximum }) {
  const rawValue = environment[name];
  if (rawValue === undefined) {
    return defaultValue;
  }
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function readIdentifier(environment, name) {
  const value = requireValue(environment, name).toUpperCase();
  if (!ORACLE_IDENTIFIER.test(value)) {
    throw new Error(`${name} must be a simple Oracle identifier`);
  }
  return value;
}

export function loadOracleConfig(environment = process.env) {
  const poolMin = readInteger(environment, "TT_ORACLE_POOL_MIN", 0, { minimum: 0, maximum: 100 });
  const poolMax = readInteger(environment, "TT_ORACLE_POOL_MAX", 4, { minimum: 1, maximum: 100 });
  const poolIncrement = readInteger(environment, "TT_ORACLE_POOL_INCREMENT", 1, { minimum: 1, maximum: 100 });

  if (poolMin > poolMax) {
    throw new Error("TT_ORACLE_POOL_MIN cannot exceed TT_ORACLE_POOL_MAX");
  }
  if (poolIncrement > poolMax) {
    throw new Error("TT_ORACLE_POOL_INCREMENT cannot exceed TT_ORACLE_POOL_MAX");
  }

  return Object.freeze({
    user: readIdentifier(environment, "TT_ORACLE_USER"),
    password: requireValue(environment, "TT_ORACLE_PASSWORD"),
    connectString: requireValue(environment, "TT_ORACLE_CONNECT_STRING"),
    schema: readIdentifier(environment, "TT_ORACLE_SCHEMA"),
    expectedDatabase: requireValue(environment, "TT_ORACLE_EXPECTED_DATABASE").toUpperCase(),
    expectedService: requireValue(environment, "TT_ORACLE_EXPECTED_SERVICE").toUpperCase(),
    poolMin,
    poolMax,
    poolIncrement,
    queueTimeout: readInteger(environment, "TT_ORACLE_QUEUE_TIMEOUT_MS", 5000, { minimum: 1, maximum: 120000 }),
    poolTimeout: readInteger(environment, "TT_ORACLE_POOL_TIMEOUT_SECONDS", 60, { minimum: 1, maximum: 3600 }),
  });
}

export function loadPort(environment = process.env) {
  return readInteger(environment, "PORT", 3000, { minimum: 1, maximum: 65535 });
}
