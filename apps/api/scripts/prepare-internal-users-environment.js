import oracledb from "oracledb";

// Operator-only preparation, never loaded by the HTTP server or granted to TT_APP.
let connection;
try {
  connection = await oracledb.getConnection({ user: "TT_OWNER", password: process.env.TT_DB_PASSWORD,
    connectString: "127.0.0.1:1521/XEPDB1" });
  const invalid = await connection.execute("SELECT COUNT(*) FROM user_objects WHERE object_type IN ('PACKAGE','PACKAGE BODY') AND status<>'VALID'");
  if (invalid.rows[0][0] !== 0) throw new Error("Invalid package");
  await connection.execute("GRANT EXECUTE ON PKG_DIAGNOSTICO_GRATUITO TO TT_APP");
  await connection.execute("GRANT EXECUTE ON PKG_USUARIOS_INTERNOS TO TT_APP");
  await connection.execute("GRANT EXECUTE ON PKG_CLIENTES_VEHICULOS_HTTP TO TT_APP");
  const admins = await connection.execute(`SELECT COUNT(*) FROM usuario u WHERE activo=1 AND tipo_actor='INTERNO'
    AND EXISTS (SELECT 1 FROM usuario_rol ur WHERE ur.id_usuario=u.id_usuario AND ur.codigo_rol='ADMINISTRADOR' AND ur.retirado_en IS NULL)`);
  console.log(`ADMIN_REQUIRED=${admins.rows[0][0] === 0 ? 1 : 0}`);
} catch {
  console.error("No se pudo validar TT_OWNER, sus paquetes o los grants de TT_APP. No se modificaron contraseñas.");
  process.exitCode = 1;
} finally { if (connection) await connection.close(); }
