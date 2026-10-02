import { createHash } from "node:crypto";

import oracledb from "oracledb";

const POSITIVE_ID = /^[1-9][0-9]{0,17}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,100}$/;
const CORRELATION = /^[\x20-\x7e]{1,100}$/;
const ORACLE_IDENTIFIER = /^[A-Z][A-Z0-9_$#]{0,29}$/;
const VERSION = /^[1-9][0-9]{0,9}$/;
// Facade errors: CODE, optionally a JSON Pointer of the offending input or the id of
// the conflicting active order (which the receptionist may consult).
const ORACLE_ERROR = /ORA-20\d{3}:\s*([A-Z_]+)(?: (\/[A-Za-z]+))?(?: ordenId=([1-9][0-9]{0,17}))?/;
const FIELD_MESSAGES = Object.freeze({ VALIDACION_DOMINIO: "La cita no corresponde a este vehículo." });

export class OpenCommercialOrderError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "OpenCommercialOrderError";
    this.code = code;
  }
}

function reject(code, message) {
  throw new OpenCommercialOrderError(code, message);
}

function id(value, field) {
  const normalized = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== "string" || !POSITIVE_ID.test(normalized)) {
    reject("INVALID_ORDER_OPENING", `${field} must be a positive identifier`);
  }
  return normalized;
}

function text(value, field, maximum) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    reject("INVALID_ORDER_OPENING", `${field} is invalid`);
  }
  return value.trim();
}

function mileage(value) {
  const normalized = typeof value === "number" ? String(value) : value;
  if (typeof normalized !== "string" || !/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9])?$/.test(normalized)) {
    reject("INVALID_ORDER_OPENING", "mileageEntry must be a non-negative value with at most one decimal");
  }
  return normalized;
}

function normalizeRequest(request, maximumFiles) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    reject("INVALID_ORDER_OPENING", "The internal order-opening request is invalid");
  }
  const allowed = new Set([
    "actorId", "sessionId", "idempotencyKey", "correlationId", "vehicleId",
    "expectedPropertyId", "expectedOwnerId", "mileageEntry", "entryReason",
    "visibleDamage", "receptionEvidence", "appointmentId", "appointmentExpectedVersion",
  ]);
  if (Object.keys(request).some((key) => !allowed.has(key))) {
    reject("INVALID_ORDER_OPENING", "The internal order-opening request contains unknown fields");
  }
  if (!Array.isArray(request.receptionEvidence)
    || request.receptionEvidence.length < 1 || request.receptionEvidence.length > maximumFiles) {
    reject("EVIDENCE_REQUIRED", `receptionEvidence must contain between 1 and ${maximumFiles} items`);
  }
  const evidence = request.receptionEvidence.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).length !== 2 || !("receipt" in item) || !("description" in item)
      || typeof item.receipt !== "string" || item.receipt === "") {
      reject("INVALID_ORDER_OPENING", "Each reception evidence item must contain only receipt and description");
    }
    return Object.freeze({ receipt: item.receipt, description: text(item.description, "description", 1000) });
  });
  if (typeof request.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(request.idempotencyKey)) {
    reject("INVALID_ORDER_OPENING", "idempotencyKey is invalid");
  }
  if (typeof request.correlationId !== "string" || !CORRELATION.test(request.correlationId)) {
    reject("INVALID_ORDER_OPENING", "correlationId is invalid");
  }
  const hasAppointment = request.appointmentId != null;
  if (hasAppointment !== (request.appointmentExpectedVersion != null)) {
    reject("INVALID_ORDER_OPENING", "appointmentId and appointmentExpectedVersion travel together");
  }
  const appointmentExpectedVersion = typeof request.appointmentExpectedVersion === "number"
    && Number.isSafeInteger(request.appointmentExpectedVersion)
    ? String(request.appointmentExpectedVersion) : request.appointmentExpectedVersion;
  if (hasAppointment && (typeof appointmentExpectedVersion !== "string" || !VERSION.test(appointmentExpectedVersion))) {
    reject("INVALID_ORDER_OPENING", "appointmentExpectedVersion is invalid");
  }
  return Object.freeze({
    actorId: id(request.actorId, "actorId"),
    // The facade requires the live session; it is never optional for an HTTP intention.
    sessionId: id(request.sessionId, "sessionId"),
    idempotencyKey: request.idempotencyKey,
    correlationId: request.correlationId,
    vehicleId: id(request.vehicleId, "vehicleId"),
    expectedPropertyId: id(request.expectedPropertyId, "expectedPropertyId"),
    expectedOwnerId: id(request.expectedOwnerId, "expectedOwnerId"),
    mileageEntry: mileage(request.mileageEntry),
    entryReason: text(request.entryReason, "entryReason", 2000),
    visibleDamage: text(request.visibleDamage, "visibleDamage", 2000),
    receptionEvidence: Object.freeze(evidence),
    appointmentId: hasAppointment ? id(request.appointmentId, "appointmentId") : null,
    appointmentExpectedVersion: hasAppointment ? appointmentExpectedVersion : null,
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function mapOracleError(error) {
  const match = ORACLE_ERROR.exec(error?.message ?? "");
  if (match === null) return error;
  const mapped = new OpenCommercialOrderError(match[1], "The commercial order could not be opened", { cause: error });
  if (match[2] !== undefined) {
    mapped.fields = [{ path: match[2], code: match[1], message: FIELD_MESSAGES[match[1]] ?? "Valor no válido." }];
  }
  if (match[3] !== undefined) mapped.details = Object.freeze({ ordenId: match[3] });
  return mapped;
}

function isExpiredButAuthentic(error) {
  return error?.code === "UPLOAD_RECEIPT_EXPIRED" && error.authenticatedPayload !== undefined;
}

function openingResult(outBinds) {
  return Object.freeze({
    orderId: outBinds.orderId,
    state: outBinds.state,
    version: Number(outBinds.version),
    contractualClientId: outBinds.clientId,
    openingPropertyId: outBinds.propertyId,
    appointmentId: outBinds.appointmentId ?? null,
    evidenceIds: Object.freeze(JSON.parse(outBinds.evidenceIdsJson)),
    repeated: outBinds.repeated === 1,
    commandId: outBinds.commandId,
    confirmedAt: outBinds.confirmedAt,
  });
}

export function createOpenCommercialOrder({
  preparedUpload,
  poolManager,
  schema,
  maximumFiles,
  driver = oracledb,
} = {}) {
  if (preparedUpload === null || typeof preparedUpload !== "object"
    || typeof preparedUpload.verifyAndRevalidate !== "function"
    || poolManager === null || typeof poolManager !== "object"
    || typeof poolManager.getConnection !== "function"
    || typeof schema !== "string" || !ORACLE_IDENTIFIER.test(schema)
    || !Number.isSafeInteger(maximumFiles) || maximumFiles < 1 || maximumFiles > 100) {
    throw new TypeError("Commercial order-opening dependencies are invalid");
  }

  return async function openCommercialOrder(request) {
    const input = normalizeRequest(request, maximumFiles);
    const expectedContext = Object.freeze({
      tipo: "RECEPCION_PREVIA",
      vehiculoId: input.vehicleId,
      propiedadEsperadaId: input.expectedPropertyId,
      propietarioEsperadoId: input.expectedOwnerId,
    });

    // Receipt verification, expiry checks, contextual binding and real-byte
    // revalidation all finish before an Oracle connection (and locks) exists.
    const settled = await Promise.allSettled(input.receptionEvidence.map((item) => (
      preparedUpload.verifyAndRevalidate({
        receipt: item.receipt,
        expectedActorId: input.actorId,
        expectedContext,
      })
    )));
    const rejected = settled.filter(({ status }) => status === "rejected").map(({ reason }) => reason);
    // An expired but authentic receipt can only resolve an intention Oracle already
    // confirmed (API contract E01); otherwise it stays a rejected receipt.
    const resolveOnly = rejected.length > 0 && rejected.every(isExpiredButAuthentic);
    if (rejected.length > 0 && !resolveOnly) throw rejected.find((reason) => !isExpiredButAuthentic(reason));
    const evidenceMetadata = settled.map((outcome, index) => {
      const payload = outcome.status === "fulfilled" ? outcome.value : outcome.reason.authenticatedPayload;
      return {
        objectKey: payload.objectKey,
        mimeType: payload.mimeType,
        sizeBytes: payload.sizeBytes,
        sha256: payload.sha256,
        intentId: payload.intentId,
        description: input.receptionEvidence[index].description,
      };
    });
    const materialRequest = {
      vehicleId: input.vehicleId,
      expectedPropertyId: input.expectedPropertyId,
      expectedOwnerId: input.expectedOwnerId,
      mileageEntry: input.mileageEntry,
      entryReason: input.entryReason,
      visibleDamage: input.visibleDamage,
      evidence: evidenceMetadata,
      // Present only with an appointment, so direct-arrival fingerprints are unchanged.
      ...(input.appointmentId === null ? {} : {
        appointmentId: input.appointmentId,
        appointmentExpectedVersion: input.appointmentExpectedVersion,
      }),
    };
    const requestHash = createHash("sha256").update(canonicalJson(materialRequest)).digest();
    const scope = `actor:${input.actorId}/T01`;
    const resultBinds = {
      orderId: { dir: driver.BIND_OUT, type: driver.STRING, maxSize: 40 },
      state: { dir: driver.BIND_OUT, type: driver.STRING, maxSize: 40 },
      version: { dir: driver.BIND_OUT, type: driver.STRING, maxSize: 20 },
      clientId: { dir: driver.BIND_OUT, type: driver.STRING, maxSize: 40 },
      propertyId: { dir: driver.BIND_OUT, type: driver.STRING, maxSize: 40 },
      evidenceIdsJson: { dir: driver.BIND_OUT, type: driver.STRING, maxSize: 4000 },
      appointmentId: { dir: driver.BIND_OUT, type: driver.STRING, maxSize: 40 },
      commandId: { dir: driver.BIND_OUT, type: driver.STRING, maxSize: 40 },
      confirmedAt: { dir: driver.BIND_OUT, type: driver.STRING, maxSize: 40 },
    };
    const connection = await poolManager.getConnection();
    let finished = false;
    try {
      if (resolveOnly) {
        const lookup = await connection.execute(
          `BEGIN ${schema}.pkg_recepcion_http.consultar_apertura_confirmada(
            :scope, :idempotencyKey, :requestHash, :actorId, :sessionId, :found,
            :orderId, :state, :version, :clientId, :propertyId, :evidenceIdsJson, :appointmentId,
            :commandId, :confirmedAt
          ); END;`,
          {
            scope,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            actorId: input.actorId,
            sessionId: input.sessionId,
            found: { dir: driver.BIND_OUT, type: driver.NUMBER },
            ...resultBinds,
          },
          { autoCommit: false },
        );
        // Read-only: release the actor/session locks taken by the revalidation.
        await connection.rollback();
        finished = true;
        if (lookup.outBinds.found !== 1) throw rejected[0];
        return openingResult({ ...lookup.outBinds, repeated: 1 });
      }
      const result = await connection.execute(
        `BEGIN ${schema}.pkg_recepcion_http.abrir_orden_comercial(
          :scope, :idempotencyKey, :requestHash, :actorId, :sessionId, :correlationId,
          :vehicleId, :expectedPropertyId, :expectedOwnerId, :mileageEntry,
          :entryReason, :visibleDamage, :evidenceJson, :appointmentIn, :appointmentVersion,
          :orderId, :state, :version, :clientId, :propertyId, :evidenceIdsJson, :appointmentId,
          :repeated, :commandId, :confirmedAt
        ); END;`,
        {
          scope,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          actorId: input.actorId,
          sessionId: input.sessionId,
          correlationId: input.correlationId,
          vehicleId: input.vehicleId,
          expectedPropertyId: input.expectedPropertyId,
          expectedOwnerId: input.expectedOwnerId,
          mileageEntry: input.mileageEntry,
          entryReason: input.entryReason,
          visibleDamage: input.visibleDamage,
          evidenceJson: { dir: driver.BIND_IN, type: driver.CLOB, val: JSON.stringify(evidenceMetadata) },
          appointmentIn: input.appointmentId,
          appointmentVersion: input.appointmentExpectedVersion,
          ...resultBinds,
          repeated: { dir: driver.BIND_OUT, type: driver.NUMBER },
        },
        { autoCommit: false },
      );
      await connection.commit();
      finished = true;
      return openingResult(result.outBinds);
    } catch (error) {
      if (!finished) {
        try { await connection.rollback(); } catch (rollbackError) {
          throw new AggregateError([mapOracleError(error), rollbackError], "Order opening and rollback both failed");
        }
      }
      throw mapOracleError(error);
    } finally {
      await connection.close();
    }
  };
}
