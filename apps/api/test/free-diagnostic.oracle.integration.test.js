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
};
function key(n) { return `12345678-1234-4567-89ab-${String(n).padStart(12, "0")}`; }

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
  assert.deepEqual(directory.payload.data.map((row) => row.id).sort(), ["101", "102"]);
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
