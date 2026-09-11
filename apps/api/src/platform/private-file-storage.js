import { createHash as createNodeHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const OBJECT_KEY = /^[0-9a-f]{32}$/;

export class PrivateFileStorageError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "PrivateFileStorageError";
    this.code = code;
  }
}

function safeStorageError(code, message, cause) {
  return new PrivateFileStorageError(code, message, cause === undefined ? undefined : { cause });
}

function validateObjectKey(objectKey) {
  if (typeof objectKey !== "string" || !OBJECT_KEY.test(objectKey)) {
    throw safeStorageError("INVALID_OBJECT_KEY", "The private object key is invalid");
  }
  return objectKey;
}

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function byteLimitAndHash(maxFileBytes, hash) {
  let size = 0;
  const stream = new Transform({
    transform(chunk, encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      size += bytes.length;
      if (size > maxFileBytes) {
        callback(safeStorageError("FILE_TOO_LARGE", "The private file exceeds the configured byte limit"));
        return;
      }
      hash.update(bytes);
      callback(null, bytes);
    },
  });
  return { stream, getSize: () => size };
}

export function createPrivateFileStorage({
  rootDirectory,
  maxFileBytes,
  prohibitedPublicDirectories = [],
  createHash = createNodeHash,
  generateKey = () => randomUUID().replaceAll("-", ""),
} = {}) {
  if (!path.isAbsolute(rootDirectory ?? "") || !Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) {
    throw safeStorageError("INVALID_STORAGE_CONFIGURATION", "Private file storage configuration is invalid");
  }

  const configuredRoot = path.resolve(rootDirectory);
  for (const publicDirectory of prohibitedPublicDirectories) {
    if (isWithin(configuredRoot, path.resolve(publicDirectory))) {
      throw safeStorageError(
        "PUBLIC_STORAGE_ROOT",
        "Private file storage cannot use a public frontend directory",
      );
    }
  }

  let initialization;
  let rootIdentity;

  async function initialize() {
    if (initialization === undefined) {
      initialization = (async () => {
        try {
          await mkdir(configuredRoot, { recursive: true, mode: 0o700 });
          const rootStat = await lstat(configuredRoot);
          if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("unsafe root");
          const resolvedRoot = await realpath(configuredRoot);
          if (path.resolve(resolvedRoot) !== configuredRoot) throw new Error("root alias");

          const probe = path.join(configuredRoot, `.probe-${randomUUID()}`);
          const handle = await open(probe, "wx", 0o600);
          try {
            await handle.writeFile("private-storage-probe");
          } finally {
            await handle.close();
            await unlink(probe).catch(() => {});
          }
          rootIdentity = { dev: rootStat.dev, ino: rootStat.ino };
        } catch (error) {
          throw safeStorageError(
            "STORAGE_UNAVAILABLE",
            "Private file storage is unavailable or unsafe",
            error,
          );
        }
      })();
    }
    return initialization;
  }

  async function assertRootIdentity() {
    await initialize();
    try {
      const current = await lstat(configuredRoot);
      if (!current.isDirectory() || current.isSymbolicLink()
        || current.dev !== rootIdentity.dev || current.ino !== rootIdentity.ino) {
        throw new Error("root changed");
      }
    } catch (error) {
      throw safeStorageError("STORAGE_UNAVAILABLE", "Private file storage is unavailable or unsafe", error);
    }
  }

  function objectPath(objectKey) {
    return path.join(configuredRoot, validateObjectKey(objectKey));
  }

  async function inspectObject(objectKey) {
    await assertRootIdentity();
    const target = objectPath(objectKey);
    try {
      const before = await lstat(target);
      if (!before.isFile() || before.isSymbolicLink()) {
        throw safeStorageError("UNSAFE_OBJECT", "The private object is unavailable");
      }
      return { before, target };
    } catch (error) {
      if (error instanceof PrivateFileStorageError) throw error;
      if (error.code === "ENOENT") return undefined;
      throw safeStorageError("STORAGE_READ_FAILED", "The private object could not be inspected", error);
    }
  }

  return Object.freeze({
    initialize,

    generateObjectKey() {
      return validateObjectKey(generateKey());
    },

    async writeObject({ objectKey, source, validate } = {}) {
      await assertRootIdentity();
      objectKey ??= validateObjectKey(generateKey());
      validateObjectKey(objectKey);
      if (source === undefined || typeof validate !== "function") {
        throw safeStorageError("INVALID_WRITE", "A byte source and validator are required");
      }

      const temporaryPath = path.join(configuredRoot, `.tmp-${randomUUID()}`);
      const target = objectPath(objectKey);
      const hash = createHash("sha256");
      const limiter = byteLimitAndHash(maxFileBytes, hash);
      try {
        const temporaryHandle = await open(temporaryPath, "wx", 0o600);
        await pipeline(source, limiter.stream, temporaryHandle.createWriteStream());
        const size = limiter.getSize();
        const sha256 = hash.digest("hex");
        const validated = await validate(temporaryPath, { size, sha256 });
        await chmod(temporaryPath, 0o400);
        await link(temporaryPath, target);
        return Object.freeze({ objectKey, size, sha256, ...validated });
      } catch (error) {
        if (error instanceof PrivateFileStorageError || error?.code === "IMAGE_VALIDATION_FAILED") throw error;
        if (error?.code === "EEXIST") {
          throw safeStorageError("OBJECT_ALREADY_EXISTS", "The private object already exists", error);
        }
        throw safeStorageError("STORAGE_WRITE_FAILED", "The private object could not be stored", error);
      } finally {
        await unlink(temporaryPath).catch(() => {});
      }
    },

    async exists(objectKey) {
      return (await inspectObject(objectKey)) !== undefined;
    },

    async openObject(objectKey) {
      const inspected = await inspectObject(objectKey);
      if (inspected === undefined) {
        throw safeStorageError("OBJECT_NOT_FOUND", "The private object was not found");
      }
      try {
        const handle = await open(inspected.target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const after = await handle.stat();
        if (!after.isFile() || after.dev !== inspected.before.dev || after.ino !== inspected.before.ino) {
          await handle.close();
          throw new Error("object changed");
        }
        return handle.createReadStream({ autoClose: true });
      } catch (error) {
        throw safeStorageError("STORAGE_READ_FAILED", "The private object could not be opened", error);
      }
    },

    async deleteOrphan(objectKey) {
      await assertRootIdentity();
      try {
        await unlink(objectPath(objectKey));
        return true;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw safeStorageError("STORAGE_DELETE_FAILED", "The orphan object could not be deleted", error);
      }
    },
  });
}
