import { stdin as input } from "node:process";

import oracledb from "oracledb";

import { createPasswordService } from "../src/modules/identity/passwords.js";

const INTERNAL_ROLES = new Set(["ADMINISTRADOR", "RECEPCIONISTA", "MECANICO", "INVENTARIO"]);
const ORACLE_IDENTIFIER = /^[A-Z][A-Z0-9_$#]{0,29}$/;

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`Missing --${name}`);
  return process.argv[index + 1];
}

async function readPassword() {
  let value = "";
  input.setEncoding("utf8");
  for await (const chunk of input) value += chunk;
  return value.replace(/\r?\n$/, "");
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value === "") throw new Error(`Missing ${name}`);
  return value;
}

async function main() {
  const login = argument("login").trim().normalize("NFKC").toLowerCase();
  const displayName = argument("name").trim();
  const roles = argument("roles").split(",").map((role) => role.trim().toUpperCase());
  if (login === "" || login.length > 150 || displayName === "" || displayName.length > 200
    || roles.length < 1 || roles.length > 4 || new Set(roles).size !== roles.length
    || roles.some((role) => !INTERNAL_ROLES.has(role))) {
    throw new Error("The explicit internal-user data is invalid");
  }
  const password = await readPassword();
  if (password.length < 12 || password.length > 128) {
    throw new Error("The internal-user password must contain between 12 and 128 characters");
  }

  const user = requiredEnvironment("TT_BOOTSTRAP_ORACLE_USER").toUpperCase();
  const schema = requiredEnvironment("TT_BOOTSTRAP_ORACLE_SCHEMA").toUpperCase();
  if (!ORACLE_IDENTIFIER.test(user) || !ORACLE_IDENTIFIER.test(schema)
    || user !== schema || user === "TT_APP" || user.startsWith("TT_TEST_APP_")) {
    throw new Error("Bootstrap requires the migrated owner schema, never TT_APP");
  }
  const passwordHash = await createPasswordService().hash(password);
  let connection;
  try {
    connection = await oracledb.getConnection({
      user,
      password: requiredEnvironment("TT_BOOTSTRAP_ORACLE_PASSWORD"),
      connectString: requiredEnvironment("TT_BOOTSTRAP_ORACLE_CONNECT_STRING"),
    });
    const result = await connection.execute(
      `BEGIN ${schema}.pkg_identidad_bootstrap.crear_usuario_interno(
        :login, :displayName, :passwordHash, :rolesJson, :userId
      ); END;`,
      {
        login,
        displayName,
        passwordHash,
        rolesJson: JSON.stringify(roles),
        userId: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 40 },
      },
      { autoCommit: false },
    );
    await connection.commit();
    process.stdout.write(`Usuario interno creado: ${result.outBinds.userId}; roles: ${roles.join(",")}\n`);
  } catch (error) {
    if (connection !== undefined) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    await connection?.close();
  }
}

main().catch(() => {
  process.stderr.write("No se pudo crear el usuario interno; no se muestran datos sensibles.\n");
  process.exitCode = 1;
});
