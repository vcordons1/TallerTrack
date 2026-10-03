import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import oracledb from "oracledb";

import { createApp } from "../src/app.js";
import { createOpaqueCursorCodec } from "../src/platform/operational-query-contract.js";
import { createOraclePoolManager } from "../src/platform/oracle-pool.js";
import { createOracleFreeDiagnostic } from "../src/modules/service-orders/oracle-free-diagnostic.js";
import { createOracleOrderQueries } from "../src/modules/service-orders/oracle-order-queries.js";

const enabled = process.env.TT_RUN_FREE_DIAGNOSTIC_ORACLE_INTEGRATION === "1";
const auth = {
  "reception.a.a": { userId: "100", sessionId: "1100", roles: ["RECEPCIONISTA"] },
  "mechanic.a.a": { userId: "101", sessionId: "1101", roles: ["MECANICO"] },
  "second.a.a": { userId: "102", sessionId: "1102", roles: ["MECANICO"] },
  "admin.a.a": { userId: "103", sessionId: "1103", roles: ["ADMINISTRADOR"] },
  "client.a.a": { userId: "104", sessionId: "1104", roles: ["CLIENTE"] },
  // TT-028 actors. The HTTP role list is a stub; Oracle revalidates roles from USUARIO_ROL.
  "receptionOther.a.a": { userId: "100", sessionId: "1200", roles: ["RECEPCIONISTA"] },
  "third.a.a": { userId: "107", sessionId: "1107", roles: ["MECANICO"] },
  "dual.a.a": { userId: "109", sessionId: "1109", roles: ["RECEPCIONISTA", "MECANICO"] },
  "inventory.a.a": { userId: "110", sessionId: "1110", roles: ["INVENTARIO"] },
};
function key(n) { return `12345678-1234-4567-89ab-${String(n).padStart(12, "0")}`; }

async function startHttp(t) {
  const poolManager = createOraclePoolManager({ driver: oracledb, config: {
    user: process.env.TT_ORACLE_USER, password: process.env.TT_ORACLE_PASSWORD,
    connectString: process.env.TT_ORACLE_CONNECT_STRING,
    poolMin: 0, poolMax: 6, poolIncrement: 1, queueTimeout: 5000, poolTimeout: 60,
  } });
  await poolManager.initialize();
  t.after(() => poolManager.close());
  const schema = process.env.TT_ORACLE_SCHEMA;
  const empty = { listCustomers: async () => [], listVehicles: async () => [], getVehicle: async () => null };
  const app = createApp({
    identityService: { authenticate: async (token) => auth[token] || null },
    customerVehicleQueries: empty,
    orderQueries: createOracleOrderQueries({ poolManager, schema }),
    freeDiagnosticRepository: createOracleFreeDiagnostic({ poolManager, schema }),
    cursorCodec: createOpaqueCursorCodec({ hmacKey: Buffer.alloc(32, 8) }),
    logger: { error() {} },
  });
  const server = app.listen(0); await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  return async function request(actor, path, method = "GET", body, idempotency) {
    const response = await fetch(base + path, { method,
      headers: { Authorization: `Bearer ${actor}.a.a`,
        ...(body ? { "Content-Type": "application/json", "Idempotency-Key": key(idempotency) } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, payload: await response.json() };
  };
}

function ownerConnection() {
  return oracledb.getConnection({ user: process.env.TT_DB_USER,
    password: process.env.TT_DB_PASSWORD, connectString: process.env.TT_ORACLE_CONNECT_STRING });
}

// Runs a real I13/I14 through PKG_USUARIOS_INTERNOS on an independent TT_APP connection and
// leaves it uncommitted, so the destination USUARIO row stays locked until `commit`.
async function pendingAccountChange(operation, targetId, roles) {
  const connection = await oracledb.getConnection({ user: process.env.TT_ORACLE_USER,
    password: process.env.TT_ORACLE_PASSWORD, connectString: process.env.TT_ORACLE_CONNECT_STRING });
  const schema = process.env.TT_ORACLE_SCHEMA;
  await connection.execute(`BEGIN ${schema}.pkg_usuarios_internos.ejecutar(:op,103,1103,:target,1,
      NULL,NULL,:roles,NULL,'Prueba de carrera',:clave,:hash,'tt028-race',:resultado,:repetido,:comando,:fecha); END;`, {
    op: operation, target: targetId, roles, clave: `race-${operation}-${targetId}`,
    hash: Buffer.alloc(32, targetId % 256),
    resultado: { dir: oracledb.BIND_OUT, type: oracledb.CLOB },
    repetido: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    comando: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 40 },
    fecha: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 40 },
  }, { autoCommit: false });
  return { async commit() { try { await connection.commit(); } finally { await connection.close(); } } };
}

async function stillPending(promise, milliseconds = 800) {
  const marker = Symbol("pending");
  const outcome = await Promise.race([promise.then(() => "settled", () => "settled"),
    new Promise((resolve) => setTimeout(() => resolve(marker), milliseconds))]);
  return outcome === marker;
}

test("HTTP and TT_APP perform the free diagnosis path against independent Oracle sessions", { skip: !enabled }, async (t) => {
  const poolManager = createOraclePoolManager({ driver: oracledb, config: {
    user: process.env.TT_ORACLE_USER, password: process.env.TT_ORACLE_PASSWORD,
    connectString: process.env.TT_ORACLE_CONNECT_STRING,
    poolMin: 0, poolMax: 6, poolIncrement: 1, queueTimeout: 5000, poolTimeout: 60,
  } });
  await poolManager.initialize();
  t.after(() => poolManager.close());
  const schema = process.env.TT_ORACLE_SCHEMA;
  const freeDiagnosticRepository = createOracleFreeDiagnostic({ poolManager, schema });
  const orderQueries = createOracleOrderQueries({ poolManager, schema });
  const empty = { listCustomers: async () => [], listVehicles: async () => [], getVehicle: async () => null };
  const app = createApp({
    identityService: { authenticate: async (token) => auth[token] || null },
    customerVehicleQueries: empty, orderQueries, freeDiagnosticRepository,
    cursorCodec: createOpaqueCursorCodec({ hmacKey: Buffer.alloc(32, 8) }),
    logger: { error() {} },
  });
  const server = app.listen(0); await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function request(actor, path, method = "GET", body, idempotency) {
    const response = await fetch(base + path, { method,
      headers: { Authorization: `Bearer ${actor}.a.a`,
        ...(body ? { "Content-Type": "application/json", "Idempotency-Key": key(idempotency) } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, payload: await response.json() };
  }
  const orders = "/interno/ordenes";
  const order = `${orders}/600`;
  const mechs = `${order}/mecanicos`;
  const works = `${order}/trabajos`;
  const diagnoses = `${order}/diagnosticos`;
  const assign = { mecanicoId: "101", motivo: "Diagnóstico" };
  const proposal = { tipo: "DIAGNOSTICO", tipoServicio: "DIAGNOSTICO",
    descripcion: "Revisar falla", diagnosticoGratuito: true };

  assert.deepEqual((await request("mechanic", `${orders}?vista=TECNICA`)).payload.data, []);
  assert.equal((await request("mechanic", `${order}?vista=TECNICA`)).status, 404);
  const directory = await request("reception", "/interno/mecanicos?ordenId=600");
  assert.equal(directory.status, 200);
  // 106 is an inactive MECANICO and stays out; 107-109 are the TT-028 fixtures.
  assert.deepEqual(directory.payload.data.map((row) => row.id).sort(), ["101", "102", "107", "108", "109"]);
  assert.equal((await request("admin", `${order}/asignar-mecanico`, "POST", assign, 1)).status, 403);
  assert.equal((await request("client", `${order}/asignar-mecanico`, "POST", assign, 2)).status, 403);
  assert.equal((await request("reception", `${order}/asignar-mecanico`, "POST",
    { mecanicoId: "100", motivo: "No es mecánico" }, 3)).status, 422);
  const assigned = await request("reception", `${order}/asignar-mecanico`, "POST", assign, 4);
  assert.equal(assigned.status, 201, JSON.stringify(assigned.payload));
  assert.equal((await request("reception", `${order}/asignar-mecanico`, "POST", assign, 4)).payload.meta.repetido, true);
  assert.equal((await request("reception", `${order}/asignar-mecanico`, "POST",
    { ...assign, motivo: "Otro" }, 4)).status, 409);
  assert.equal((await request("reception", `${order}/asignar-mecanico`, "POST", assign, 5)).status, 409);
  const participants = await request("reception", `${mechs}?vigentes=true`);
  if (participants.status !== 200) await freeDiagnosticRepository.read("participants", {
    actorId: "100", sessionId: "1100", orderId: "600", active: true, limit: 25,
  });
  assert.equal(participants.status, 200, JSON.stringify(participants.payload));
  assert.equal(participants.payload.data.length, 1);

  const technicalList = await request("mechanic", `${orders}?vista=TECNICA`);
  assert.equal(technicalList.status, 200);
  assert.deepEqual(technicalList.payload.data.map((row) => row.id), ["600"]);
  assert.equal((await request("mechanic", `${orders}/601?vista=TECNICA`)).status, 404);
  const technical = (await request("mechanic", `${order}?vista=TECNICA`)).payload.data;
  assert.equal(technical.estado, "RECIBIDO");
  assert.equal(Object.hasOwn(technical, "saldo"), false);
  assert.equal(Object.hasOwn(technical, "clienteContractual"), false);
  assert.equal((await request("mechanic", `${works}/700/iniciar`, "POST",
    { versionEsperada: "1", motivo: "No autorizado" }, 22)).status, 422);
  assert.equal((await request("mechanic", `${works}/701/iniciar`, "POST",
    { versionEsperada: "1", motivo: "No autorizado" }, 23)).status, 422);
  assert.equal((await request("mechanic", `${works}/702/iniciar`, "POST",
    { versionEsperada: "1", motivo: "Otra orden" }, 24)).status, 404);

  assert.equal((await request("mechanic", works, "POST", { ...proposal, diagnosticoGratuito: false }, 6)).status, 422);
  assert.equal((await request("mechanic", works, "POST", { ...proposal, tipo: "REPARACION" }, 7)).status, 422);
  const proposed = await request("mechanic", works, "POST", proposal, 8);
  assert.equal(proposed.status, 201, JSON.stringify(proposed.payload));
  const workId = proposed.payload.data.trabajoId;
  assert.equal((await request("mechanic", works, "POST", proposal, 8)).payload.meta.repetido, true);
  const report = { trabajoDiagnosticoId: workId, detalleTecnico: "Sensor defectuoso",
    resumenCliente: "Se detectó un sensor defectuoso" };
  assert.equal((await request("mechanic", `${diagnoses}/confirmar`, "POST", report, 9)).status, 409);

  const owner = await oracledb.getConnection({ user: process.env.TT_DB_USER,
    password: process.env.TT_DB_PASSWORD, connectString: process.env.TT_ORACLE_CONNECT_STRING });
  let triggerCreated = false;
  try {
    await owner.execute(`CREATE OR REPLACE TRIGGER dg_test_event_failure
      BEFORE INSERT ON orden_evento FOR EACH ROW
      BEGIN
        IF :NEW.id_orden = 600 AND :NEW.estado_nuevo = 'EN_DIAGNOSTICO' THEN
          RAISE_APPLICATION_ERROR(-20999, 'Injected order event failure');
        END IF;
      END;`);
    triggerCreated = true;
    const failedStart = await request("mechanic", `${works}/${workId}/iniciar`, "POST",
      { versionEsperada: "1", motivo: "Inicio" }, 25);
    assert.equal(failedStart.status, 500);
    const afterFailure = await owner.execute(`SELECT
      (SELECT estado FROM trabajo WHERE id_trabajo = :workId),
      (SELECT estado FROM orden_trabajo WHERE id_orden = 600),
      (SELECT COUNT(*) FROM trabajo_evento WHERE id_trabajo = :workId),
      (SELECT COUNT(*) FROM comando WHERE clave_idempotencia = :commandKey)
      FROM dual`, { workId, commandKey: key(25) });
    assert.deepEqual(afterFailure.rows[0], ["PROPUESTO", "RECIBIDO", 0, 0]);
  } finally {
    if (triggerCreated) await owner.execute("DROP TRIGGER dg_test_event_failure");
    await owner.close();
  }

  assert.equal((await request("mechanic", `${works}/${workId}/iniciar`, "POST",
    { versionEsperada: "2", motivo: "Inicio" }, 10)).status, 409);
  const startBody = { versionEsperada: "1", motivo: "Inicio" };
  const started = await request("mechanic", `${works}/${workId}/iniciar`, "POST", startBody, 11);
  assert.equal(started.status, 200, JSON.stringify(started.payload));
  assert.equal(started.payload.data.ordenEstado, "EN_DIAGNOSTICO");
  assert.equal((await request("mechanic", `${works}/${workId}/iniciar`, "POST", startBody, 11)).payload.meta.repetido, true);
  assert.equal((await request("mechanic", `${works}/${workId}/iniciar`, "POST", startBody, 12)).status, 409);
  assert.equal((await request("mechanic", `${order}?vista=TECNICA`)).payload.data.estado, "EN_DIAGNOSTICO");
  assert.equal((await request("mechanic", works)).payload.data.find((row) => row.id === workId).estado, "EN_EJECUCION");

  const confirmed = await request("mechanic", `${diagnoses}/confirmar`, "POST", report, 13);
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.payload));
  assert.equal(confirmed.payload.data.numeroRevision, 1);
  assert.equal((await request("mechanic", `${diagnoses}/confirmar`, "POST", report, 13)).payload.meta.repetido, true);
  const second = await request("mechanic", `${diagnoses}/confirmar`, "POST",
    { ...report, detalleTecnico: "Sensor revisado nuevamente" }, 14);
  assert.equal(second.status, 201);
  assert.equal(second.payload.data.numeroRevision, 2);
  const reports = (await request("mechanic", diagnoses)).payload.data;
  assert.equal(reports[0].revisionAnteriorId, reports[1].id);
  assert.equal(reports[0].detalleTecnico, "Sensor revisado nuevamente");
  assert.equal((await request("reception", diagnoses)).payload.data[0].detalleTecnico, null);

  const concurrencyAssign = await Promise.all([
    request("reception", `${order}/asignar-mecanico`, "POST", { mecanicoId: "102", motivo: "Ayuda" }, 15),
    request("reception", `${order}/asignar-mecanico`, "POST", { mecanicoId: "102", motivo: "Ayuda" }, 16),
  ]);
  assert.deepEqual(concurrencyAssign.map((result) => result.status).sort(), [201, 409]);
  const proposedAgain = await request("mechanic", works, "POST",
    { ...proposal, descripcion: "Segunda revisión" }, 17);
  const secondWorkId = proposedAgain.payload.data.trabajoId;
  const concurrentStart = await Promise.all([
    request("mechanic", `${works}/${secondWorkId}/iniciar`, "POST", startBody, 18),
    request("mechanic", `${works}/${secondWorkId}/iniciar`, "POST", startBody, 19),
  ]);
  assert.deepEqual(concurrentStart.map((result) => result.status).sort(), [200, 409]);

  const retired = await request("reception", `${order}/participaciones/${assigned.payload.data.participacionId}/retirar`,
    "POST", { motivo: "Fin de participación" }, 20);
  assert.equal(retired.status, 200, JSON.stringify(retired.payload));
  assert.equal((await request("mechanic", `${order}?vista=TECNICA`)).status, 404);
  assert.equal((await request("mechanic", `${diagnoses}/confirmar`, "POST", report, 21)).status, 403);
  assert.equal((await request("mechanic", `${works}/${workId}/iniciar`, "POST", startBody, 11)).status, 403);
  assert.equal((await request("reception", mechs)).payload.data.length, 2);
});

test("TT-028 assignment: permissions, replay, races, rollback and technical projection", { skip: !enabled }, async (t) => {
  const request = await startHttp(t);
  const order = "/interno/ordenes/603";
  const mechs = `${order}/mecanicos`;
  const directory = "/interno/mecanicos?ordenId=603";
  const code = (result) => result.payload.error?.code;

  // I15: R or a current participant M only; active MECANICO accounts with id/name only.
  assert.equal((await request("admin", directory)).status, 403);
  assert.equal((await request("mechanic", directory)).status, 403);
  assert.equal((await request("client", directory)).status, 403);
  assert.equal((await request("inventory", directory)).status, 403);
  assert.equal((await request("reception", "/interno/mecanicos")).status, 400);
  const eligible = await request("reception", directory);
  assert.equal(eligible.status, 200);
  assert.deepEqual(eligible.payload.data.map((row) => row.id).sort(), ["101", "102", "107", "108", "109"]);
  for (const row of eligible.payload.data) assert.deepEqual(Object.keys(row).sort(), ["id", "nombre"]);
  assert.deepEqual((await request("reception", `${directory}&q=tres`)).payload.data, [{ id: "107", nombre: "Mecanico Tres" }]);

  // O06 rejections leave no fact: destination without role, inactive or absent; closed order.
  for (const [mecanicoId, n] of [["105", 30], ["106", 31], ["999999", 32]]) {
    const rejected = await request("reception", `${order}/asignar-mecanico`, "POST", { mecanicoId, motivo: "Prueba" }, n);
    assert.equal(rejected.status, 422);
    assert.equal(code(rejected), "ROL_REQUERIDO");
  }
  const closed = await request("reception", "/interno/ordenes/602/asignar-mecanico", "POST",
    { mecanicoId: "101", motivo: "Prueba" }, 33);
  assert.equal(closed.status, 409);
  assert.equal(code(closed), "ESTADO_INCOMPATIBLE");
  assert.equal((await request("admin", `${order}/asignar-mecanico`, "POST", { mecanicoId: "101", motivo: "A" }, 34)).status, 403);
  assert.equal((await request("mechanic", `${order}/asignar-mecanico`, "POST", { mecanicoId: "101", motivo: "M" }, 35)).status, 403);

  // O06 success, lost-response replay, key reuse with another body, replay from another session.
  const assignBody = { mecanicoId: "101", motivo: "Diagnóstico inicial" };
  const first = await request("reception", `${order}/asignar-mecanico`, "POST", assignBody, 40);
  assert.equal(first.status, 201, JSON.stringify(first.payload));
  assert.deepEqual(Object.keys(first.payload.data).sort(), ["mecanicoId", "participacionId"]);
  const replay = await request("reception", `${order}/asignar-mecanico`, "POST", assignBody, 40);
  assert.equal(replay.status, 201);
  assert.equal(replay.payload.meta.repetido, true);
  assert.deepEqual(replay.payload.data, first.payload.data);
  assert.equal(replay.payload.meta.comandoId, first.payload.meta.comandoId);
  const reused = await request("reception", `${order}/asignar-mecanico`, "POST", { ...assignBody, motivo: "Otro" }, 40);
  assert.equal(reused.status, 409);
  assert.equal(code(reused), "CLAVE_REUTILIZADA");
  // Documented limitation: the session is part of the intention, so a new session cannot replay it.
  const otherSession = await request("receptionOther", `${order}/asignar-mecanico`, "POST", assignBody, 40);
  assert.equal(otherSession.status, 409);
  assert.equal(code(otherSession), "CLAVE_REUTILIZADA");
  const duplicate = await request("reception", `${order}/asignar-mecanico`, "POST", assignBody, 41);
  assert.equal(duplicate.status, 409);
  assert.equal(code(duplicate), "REFERENCIA_DUPLICADA");

  // TECNICA projection: only the current participant; never for A/R/I; R+M defaults to RECEPCION.
  const technical = await request("mechanic", `${order}?vista=TECNICA`);
  assert.equal(technical.status, 200);
  for (const field of ["clienteContractual", "saldo", "propiedadAperturaId", "citaId"]) {
    assert.equal(Object.hasOwn(technical.payload.data, field), false, field);
  }
  assert.equal((await request("second", `${order}?vista=TECNICA`)).status, 404);
  assert.equal((await request("reception", `${order}?vista=TECNICA`)).status, 403);
  assert.equal((await request("admin", "/interno/ordenes?vista=TECNICA")).status, 403);
  assert.equal((await request("inventory", `${order}?vista=TECNICA`)).status, 403);
  const dualDefault = await request("dual", order);
  assert.equal(dualDefault.status, 200);
  assert.equal(dualDefault.payload.data.clienteContractual.id, "200");
  assert.deepEqual((await request("dual", "/interno/ordenes?vista=TECNICA")).payload.data, []);
  const receptionRegression = await request("reception", "/interno/ordenes?estado=RECIBIDO&activas=true");
  assert.equal(receptionRegression.status, 200);
  assert.ok(receptionRegression.payload.data.some((row) => row.id === "603" && row.clienteContractual));

  // A current participant may coordinate (contract O06/O07) and read I15/O05.
  assert.equal((await request("mechanic", directory)).status, 200);
  const byMechanic = await request("mechanic", `${order}/asignar-mecanico`, "POST", { mecanicoId: "102", motivo: "Apoyo" }, 42);
  assert.equal(byMechanic.status, 201, JSON.stringify(byMechanic.payload));

  // O05: A supervises, I and non-participant M cannot; vigentes filter.
  assert.equal((await request("admin", mechs)).status, 200);
  assert.equal((await request("inventory", mechs)).status, 403);
  assert.equal((await request("third", mechs)).status, 403);
  assert.equal((await request("reception", `${mechs}?vigentes=true`)).payload.data.length, 2);

  // O07: two concurrent retirements of the same participation produce one retirement.
  const target = byMechanic.payload.data.participacionId;
  const retireBody = { motivo: "Ya no participa" };
  const retirements = await Promise.all([
    request("reception", `${order}/participaciones/${target}/retirar`, "POST", retireBody, 43),
    request("reception", `${order}/participaciones/${target}/retirar`, "POST", retireBody, 44),
  ]);
  assert.deepEqual(retirements.map((result) => result.status).sort(), [200, 409]);
  const winner = retirements.find((result) => result.status === 200);
  assert.equal(code(retirements.find((result) => result.status === 409)), "ESTADO_INCOMPATIBLE");
  const winnerKey = winner === retirements[0] ? 43 : 44;
  const retireReplay = await request("reception", `${order}/participaciones/${target}/retirar`, "POST", retireBody, winnerKey);
  assert.equal(retireReplay.payload.meta.repetido, true);
  assert.deepEqual(retireReplay.payload.data, winner.payload.data);
  assert.equal(code(await request("reception", `${order}/participaciones/${target}/retirar`, "POST",
    { motivo: "Otro motivo" }, winnerKey)), "CLAVE_REUTILIZADA");
  assert.equal(code(await request("reception", `${order}/participaciones/${target}/retirar`, "POST", retireBody, 45)),
    "ESTADO_INCOMPATIBLE");
  // The retired mechanic loses the technical view and the participant list of that order.
  assert.equal((await request("second", "/interno/ordenes?vista=TECNICA")).payload.data.some((row) => row.id === "603"), false);
  assert.equal((await request("second", `${order}?vista=TECNICA`)).status, 404);
  assert.equal((await request("second", mechs)).status, 403);
  assert.equal((await request("second", `${order}/asignar-mecanico`, "POST", { mecanicoId: "102", motivo: "Volver" }, 46)).status, 403);
  const history = (await request("reception", `${mechs}?vigentes=false`)).payload.data;
  assert.equal(history.length, 1);
  assert.equal(history[0].motivoRetiro, "Ya no participa");
  assert.ok(history[0].retiradoEn);

  // A retired mechanic can be assigned again as a new period, then retired (history keeps both).
  const reassigned = await request("reception", `${order}/asignar-mecanico`, "POST", { mecanicoId: "102", motivo: "Vuelve" }, 47);
  assert.equal(reassigned.status, 201);
  assert.equal((await request("reception", `${order}/participaciones/${reassigned.payload.data.participacionId}/retirar`,
    "POST", { motivo: "Termina" }, 48)).status, 200);

  // Race: O06 waits for a concurrent I13 that removes MECANICO and then refuses the assignment.
  const roleChange = await pendingAccountChange("I13", 107, "[\"RECEPCIONISTA\"]");
  const blockedByRole = request("reception", `${order}/asignar-mecanico`, "POST", { mecanicoId: "107", motivo: "Carrera" }, 50);
  assert.equal(await stillPending(blockedByRole), true, "O06 must wait for the destination account lock");
  await roleChange.commit();
  const afterRole = await blockedByRole;
  assert.equal(afterRole.status, 422);
  assert.equal(code(afterRole), "ROL_REQUERIDO");
  // Race: O06 waits for a concurrent I14 that deactivates the account.
  const deactivation = await pendingAccountChange("I14", 108, null);
  const blockedByAccount = request("reception", `${order}/asignar-mecanico`, "POST", { mecanicoId: "108", motivo: "Carrera" }, 51);
  assert.equal(await stillPending(blockedByAccount), true, "O06 must wait for the destination account lock");
  await deactivation.commit();
  assert.equal(code(await blockedByAccount), "ROL_REQUERIDO");

  // Rollback: a failure after the participation insert leaves neither participation nor COMANDO.
  const owner = await ownerConnection();
  try {
    let triggerCreated = false;
    try {
      await owner.execute(`CREATE OR REPLACE TRIGGER tt028_assignment_audit_failure
        BEFORE INSERT ON auditoria_evento FOR EACH ROW
        BEGIN
          IF :NEW.accion = 'ASIGNAR_MECANICO' AND :NEW.identificador_recurso = '603' THEN
            RAISE_APPLICATION_ERROR(-20999, 'Injected assignment audit failure');
          END IF;
        END;`);
      triggerCreated = true;
      const failed = await request("reception", `${order}/asignar-mecanico`, "POST", { mecanicoId: "109", motivo: "Fallo" }, 52);
      assert.equal(failed.status, 500);
      const facts = await owner.execute(`SELECT
        (SELECT COUNT(*) FROM orden_mecanico WHERE id_orden = 603 AND id_mecanico = 109),
        (SELECT COUNT(*) FROM comando WHERE clave_idempotencia = :commandKey) FROM dual`, { commandKey: key(52) });
      assert.deepEqual(facts.rows[0], [0, 0]);
    } finally {
      if (triggerCreated) await owner.execute("DROP TRIGGER tt028_assignment_audit_failure");
    }
    const recovered = await request("reception", `${order}/asignar-mecanico`, "POST", { mecanicoId: "109", motivo: "Fallo" }, 52);
    assert.equal(recovered.status, 201, JSON.stringify(recovered.payload));
    assert.deepEqual((await request("dual", "/interno/ordenes?vista=TECNICA")).payload.data.map((row) => row.id), ["603"]);

    // Retirement keeps the row and its authorship.
    const kept = await owner.execute(`SELECT COUNT(*) FROM orden_mecanico
      WHERE id_participacion = :id AND retirado_por = 100 AND motivo_retiro = 'Ya no participa' AND asignado_por = 101`,
    { id: target });
    assert.equal(kept.rows[0][0], 1);
  } finally {
    await owner.close();
  }
});
