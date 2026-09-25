import { createHash, randomBytes, randomUUID } from "node:crypto";

import oracledb from "oracledb";

const ORACLE_IDENTIFIER = /^[A-Z][A-Z0-9_$#]{0,29}$/;

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value === "") throw new Error(`Missing ${name}`);
  return value;
}

async function main() {
  const user = required("TT_BOOTSTRAP_ORACLE_USER").toUpperCase();
  const schema = required("TT_BOOTSTRAP_ORACLE_SCHEMA").toUpperCase();
  if (!ORACLE_IDENTIFIER.test(user) || user !== schema || user === "TT_APP" || user.startsWith("TT_TEST_APP_")) {
    throw new Error("Demo bootstrap requires the migrated owner schema, never TT_APP");
  }

  let connection;
  try {
    connection = await oracledb.getConnection({
      user,
      password: required("TT_BOOTSTRAP_ORACLE_PASSWORD"),
      connectString: required("TT_BOOTSTRAP_ORACLE_CONNECT_STRING"),
    });
    const existing = await connection.execute(
      `SELECT TO_CHAR(c.id_cliente,'FM999999999999999999') cliente_id, c.nombre,
              TO_CHAR(v.id_vehiculo,'FM999999999999999999') vehiculo_id,
              TO_CHAR(p.id_propiedad,'FM999999999999999999') propiedad_id, v.placa
         FROM ${schema}.cliente c
         JOIN ${schema}.propiedad_vehiculo p ON p.id_cliente=c.id_cliente AND p.hasta_en IS NULL
         JOIN ${schema}.vehiculo v ON v.id_vehiculo=p.id_vehiculo AND v.activo=1
        WHERE c.activo=1
          AND NOT EXISTS (SELECT 1 FROM ${schema}.orden_trabajo o WHERE o.id_vehiculo=v.id_vehiculo
                           AND o.estado NOT IN ('ENTREGADO','ENTREGADO_SIN_REPARACION','CANCELADO'))
        ORDER BY CASE WHEN c.nit='DEMO-TT022' THEN 0 ELSE 1 END, v.creado_en DESC
        FETCH FIRST 1 ROW ONLY`,
      {}, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      process.stdout.write(`Escenario listo: cliente=${row.CLIENTE_ID}; nombre=${row.NOMBRE}; vehiculo=${row.VEHICULO_ID}; propiedad=${row.PROPIEDAD_ID}; placa=${row.PLACA ?? "SIN_PLACA"}\n`);
      return;
    }

    const actorResult = await connection.execute(
      `SELECT TO_CHAR(id_usuario,'FM999999999999999999') FROM ${schema}.usuario u WHERE u.tipo_actor='INTERNO' AND u.activo=1
        AND EXISTS (SELECT 1 FROM ${schema}.usuario_rol ur WHERE ur.id_usuario=u.id_usuario
                    AND ur.codigo_rol IN ('ADMINISTRADOR','RECEPCIONISTA') AND ur.retirado_en IS NULL)
        ORDER BY CASE WHEN EXISTS (SELECT 1 FROM ${schema}.usuario_rol ur WHERE ur.id_usuario=u.id_usuario
                    AND ur.codigo_rol='RECEPCIONISTA' AND ur.retirado_en IS NULL) THEN 0 ELSE 1 END, id_usuario
        FETCH FIRST 1 ROW ONLY`,
    );
    if (actorResult.rows.length === 0) throw new Error("An active ADMINISTRADOR or RECEPCIONISTA must be bootstrapped first");
    const actorId = actorResult.rows[0][0];

    let clientId;
    const clientResult = await connection.execute(
      `SELECT TO_CHAR(id_cliente,'FM999999999999999999') FROM ${schema}.cliente WHERE nit='DEMO-TT022' AND activo=1 FETCH FIRST 1 ROW ONLY`,
    );
    if (clientResult.rows.length > 0) clientId = clientResult.rows[0][0];
    else {
      const inserted = await connection.execute(
        `INSERT INTO ${schema}.cliente(nombre,telefono,email,direccion,nit,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
         VALUES(:name,NULL,NULL,NULL,'DEMO-TT022',1,SYSTIMESTAMP,:actor,SYSTIMESTAMP,:actor,1)
         RETURNING id_cliente INTO :id`,
        {
          name: "Cliente demo recepción", actor: actorId,
          id: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 40 },
        }, { autoCommit: false },
      );
      [clientId] = inserted.outBinds.id;
    }

    const suffix = randomBytes(3).toString("hex").toUpperCase();
    const plate = `DEMO-${suffix}`;
    const key = randomUUID();
    const requestHash = createHash("sha256").update(`demo-reception:${clientId}:${plate}`).digest();
    const qrHash = createHash("sha256").update(randomBytes(32)).digest();
    const registered = await connection.execute(
      `BEGIN ${schema}.pkg_vehiculos.registrar_vehiculo(
        :scope,:key,:requestHash,:actor,NULL,:correlation,:clientId,
        'AUTOMOVIL',:plate,NULL,'Vehículo','Demo',2024,NULL,'Escenario operativo TT-022',
        :qrHash,NULL,:vehicleId,:propertyId,:qrId,:repeated
      ); END;`,
      {
        scope: `actor:${actorId}/DEMO_RECEPTION`, key, requestHash, actor: actorId,
        correlation: randomUUID(), clientId, plate, qrHash,
        vehicleId: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 40 },
        propertyId: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 40 },
        qrId: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 40 },
        repeated: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }, { autoCommit: false },
    );
    await connection.commit();
    process.stdout.write(`Escenario creado: cliente=${clientId}; nombre=Cliente demo recepción; vehiculo=${registered.outBinds.vehicleId}; propiedad=${registered.outBinds.propertyId}; placa=${plate}\n`);
  } catch (error) {
    await connection?.rollback().catch(() => {});
    throw error;
  } finally {
    await connection?.close();
  }
}

main().catch(() => {
  process.stderr.write("No se pudo preparar el escenario de recepción; no se muestran datos sensibles.\n");
  process.exitCode = 1;
});
