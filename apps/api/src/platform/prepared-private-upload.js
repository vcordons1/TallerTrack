import { createHash } from "node:crypto";

import { UploadReceiptError } from "./upload-receipt.js";

export class PreparedPrivateUploadError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "PreparedPrivateUploadError";
    this.code = code;
  }
}

function mismatch(code, cause) {
  return new PreparedPrivateUploadError(
    code,
    "The prepared private object is unavailable or no longer matches its receipt",
    cause === undefined ? undefined : { cause },
  );
}

async function hashStream(stream) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    hash.update(bytes);
  }
  return { size, sha256: hash.digest("hex") };
}

export function createPreparedPrivateUpload({ storage, validateTechnicalImage, receiptSigner } = {}) {
  if (storage === null || typeof storage !== "object"
    || typeof storage.writeObject !== "function" || typeof storage.exists !== "function"
    || typeof storage.openObject !== "function" || typeof validateTechnicalImage !== "function"
    || receiptSigner === null || typeof receiptSigner !== "object"
    || typeof receiptSigner.issue !== "function" || typeof receiptSigner.verify !== "function") {
    throw new TypeError("Prepared private upload dependencies are invalid");
  }

  async function prepare({ source, declaredMimeType, actorId, context } = {}) {
    let stored;
    try {
      stored = await storage.writeObject({
        source,
        validate: (filePath, facts) => validateTechnicalImage(filePath, { ...facts, declaredMimeType }),
      });
      if (!(await storage.exists(stored.objectKey))) {
        throw mismatch("PREPARED_OBJECT_NOT_PUBLISHED");
      }
      const issued = receiptSigner.issue({
        actorId,
        context: await context,
        object: {
          objectKey: stored.objectKey,
          mimeType: stored.mimeType,
          sizeBytes: stored.size,
          sha256: stored.sha256,
        },
      });
      return Object.freeze({
        receipt: issued.receipt,
        expiresAt: new Date(issued.payload.expiresAt).toISOString(),
        objectKey: stored.objectKey,
        mimeType: stored.mimeType,
        sizeBytes: stored.size,
        sha256: stored.sha256,
      });
    } catch (error) {
      if (stored !== undefined) await storage.deleteOrphan(stored.objectKey).catch(() => {});
      throw error;
    }
  }

  async function verifyAndRevalidate({ receipt, expectedActorId, expectedContext } = {}) {
    const payload = receiptSigner.verify(receipt, { expectedActorId, expectedContext });
    let stream;
    try {
      stream = await storage.openObject(payload.objectKey);
    } catch (error) {
      throw mismatch("PREPARED_OBJECT_NOT_FOUND", error);
    }
    let actual;
    try {
      actual = await hashStream(stream);
    } catch (error) {
      throw mismatch("PREPARED_OBJECT_READ_FAILED", error);
    }
    if (String(actual.size) !== payload.sizeBytes || actual.sha256 !== payload.sha256) {
      throw mismatch("PREPARED_OBJECT_METADATA_MISMATCH");
    }

    try {
      const verified = await storage.validateObject(payload.objectKey, ({ filePath, size, sha256 }) => (
        validateTechnicalImage(filePath, {
          size,
          sha256,
          declaredMimeType: payload.mimeType,
        })
      ));
      if (verified.mimeType !== payload.mimeType
        || String(verified.size) !== payload.sizeBytes || verified.sha256 !== payload.sha256) {
        throw mismatch("PREPARED_OBJECT_METADATA_MISMATCH");
      }
    } catch (error) {
      if (error instanceof PreparedPrivateUploadError) throw error;
      throw mismatch("PREPARED_OBJECT_METADATA_MISMATCH", error);
    }
    return payload;
  }

  async function discardPrepared(prepared) {
    if (prepared === null || typeof prepared !== "object" || typeof prepared.objectKey !== "string") {
      throw new TypeError("Prepared private upload cleanup target is invalid");
    }
    return storage.deleteOrphan(prepared.objectKey);
  }

  return Object.freeze({ prepare, verifyAndRevalidate, discardPrepared });
}

export function isUploadReceiptFailure(error) {
  return error instanceof UploadReceiptError || error instanceof PreparedPrivateUploadError;
}
