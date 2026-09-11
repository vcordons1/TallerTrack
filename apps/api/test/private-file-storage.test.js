import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import sharp from "sharp";

import { createPrivateFileStorage } from "../src/platform/private-file-storage.js";
import { createTechnicalImageValidator } from "../src/platform/technical-image-validator.js";

const keyA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async function temporaryDirectory(t, prefix = "tallertrack-private-") {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function fixture(format, { width = 4, height = 3 } = {}) {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 31, g: 127, b: 223 } },
  });
  return format === "jpeg" ? image.jpeg({ quality: 90 }).toBuffer() : image.png().toBuffer();
}

function storageAt(rootDirectory, maxFileBytes = 1024 * 1024) {
  return createPrivateFileStorage({ rootDirectory, maxFileBytes });
}

function validator(limits = {}) {
  return createTechnicalImageValidator({ maxPixels: 1_000_000, maxDimension: 2000, ...limits });
}

async function storeImage(storage, bytes, declaredMimeType, validate = validator(), objectKey) {
  return storage.writeObject({
    objectKey,
    source: Readable.from(bytes),
    validate: (filePath, facts) => validate(filePath, { ...facts, declaredMimeType }),
  });
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test("valid JPEG and PNG bytes are decoded, hashed, stored, and recovered exactly", async (t) => {
  const root = await temporaryDirectory(t);
  const storage = storageAt(root);
  await storage.initialize();

  for (const [format, mimeType, width, height] of [
    ["jpeg", "image/jpeg", 7, 5],
    ["png", "image/png", 6, 4],
  ]) {
    const bytes = await fixture(format, { width, height });
    const result = await storeImage(storage, bytes, mimeType);
    assert.match(result.objectKey, /^[0-9a-f]{32}$/);
    assert.deepEqual(
      { format: result.format, mimeType: result.mimeType, width: result.width, height: result.height, pixels: result.pixels, size: result.size },
      { format, mimeType, width, height, pixels: width * height, size: bytes.length },
    );
    assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(await storage.exists(result.objectKey), true);
    assert.deepEqual(await readAll(await storage.openObject(result.objectKey)), bytes);
    assert.equal(await storage.deleteOrphan(result.objectKey), true);
    assert.equal(await storage.exists(result.objectKey), false);
  }
});

test("corrupt images, disguised active content, executables, and MIME spoofing are rejected", async (t) => {
  const root = await temporaryDirectory(t);
  const storage = storageAt(root);
  const jpeg = await fixture("jpeg");
  const png = await fixture("png");
  const cases = [
    [jpeg.subarray(0, jpeg.length - 2), "image/jpeg", "corrupt JPEG"],
    [png.subarray(0, png.length - 8), "image/png", "corrupt PNG"],
    [Buffer.from("<!doctype html><h1>not an image</h1>"), "image/jpeg", "HTML named jpg"],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), "image/svg+xml", "SVG"],
    [Buffer.from("MZ\u0000\u0002executable"), "image/jpeg", "executable"],
    [jpeg, "image/png", "declared MIME mismatch"],
    [Buffer.concat([jpeg, Buffer.from("<script>alert(1)</script>")]), "image/jpeg", "JPEG polyglot trailer"],
  ];

  for (const [bytes, mimeType, label] of cases) {
    await assert.rejects(storeImage(storage, bytes, mimeType), (error) => {
      assert.equal(error.code, "IMAGE_VALIDATION_FAILED", label);
      assert.equal(error.message.includes(root), false, label);
      return true;
    });
  }
  assert.deepEqual(await readdir(root), []);
});

test("configured byte and dimension limits reject the whole object", async (t) => {
  const root = await temporaryDirectory(t);
  const png = await fixture("png", { width: 11, height: 10 });

  await assert.rejects(
    storeImage(storageAt(root, png.length - 1), png, "image/png"),
    (error) => error.code === "FILE_TOO_LARGE",
  );
  await assert.rejects(
    storeImage(storageAt(root), png, "image/png", validator({ maxPixels: 200, maxDimension: 10 })),
    (error) => error.code === "IMAGE_VALIDATION_FAILED" && error.reason === "IMAGE_DIMENSIONS_EXCEEDED",
  );
  assert.deepEqual(await readdir(root), []);
});

test("the initial 25 MP profile fully decodes a synthetic 24 MP JPEG and rejects an image above the pixel limit", async (t) => {
  const root = await temporaryDirectory(t);
  const storage = storageAt(root, 10_485_760);
  const initialProfile = validator({ maxPixels: 25_000_000, maxDimension: 8192 });
  const withinProfile = await fixture("jpeg", { width: 6000, height: 4000 });
  const result = await storeImage(storage, withinProfile, "image/jpeg", initialProfile);
  assert.deepEqual(
    { width: result.width, height: result.height, pixels: result.pixels },
    { width: 6000, height: 4000, pixels: 24_000_000 },
  );

  const aboveProfile = await fixture("jpeg", { width: 5001, height: 5000 });
  await assert.rejects(
    storeImage(storage, aboveProfile, "image/jpeg", initialProfile),
    (error) => error.code === "IMAGE_VALIDATION_FAILED",
  );
});

test("path traversal, absolute paths, and existing-object overwrite are rejected without data loss", async (t) => {
  const root = await temporaryDirectory(t);
  const storage = storageAt(root);
  const original = await fixture("png");
  const replacement = await fixture("jpeg");
  await storeImage(storage, original, "image/png", validator(), keyA);

  for (const invalidKey of ["../outside", "..\\outside", path.resolve(root, "outside"), "a/b", ".tmp-object"]) {
    await assert.rejects(storage.openObject(invalidKey), (error) => error.code === "INVALID_OBJECT_KEY");
    await assert.rejects(
      storage.writeObject({ objectKey: invalidKey, source: Readable.from(original), validate: validator() }),
      (error) => error.code === "INVALID_OBJECT_KEY",
    );
  }
  await assert.rejects(
    storeImage(storage, replacement, "image/jpeg", validator(), keyA),
    (error) => error.code === "OBJECT_ALREADY_EXISTS",
  );
  assert.deepEqual(await readAll(await storage.openObject(keyA)), original);
  assert.deepEqual((await readdir(root)).sort(), [keyA]);
});

test("an interrupted write removes temporaries and never publishes a confirmed object", async (t) => {
  const root = await temporaryDirectory(t);
  const storage = storageAt(root);
  const jpeg = await fixture("jpeg");
  async function* interrupted() {
    yield jpeg.subarray(0, 20);
    throw new Error("simulated source failure");
  }

  await assert.rejects(
    storage.writeObject({ objectKey: keyA, source: Readable.from(interrupted()), validate: validator() }),
    (error) => error.code === "STORAGE_WRITE_FAILED" && !error.message.includes(root),
  );
  assert.equal(await storage.exists(keyA), false);
  assert.deepEqual(await readdir(root), []);
});

test("concurrent writes receive unique opaque keys and leave no temporary files", async (t) => {
  const root = await temporaryDirectory(t);
  const storage = storageAt(root);
  const png = await fixture("png");
  const results = await Promise.all(Array.from({ length: 32 }, () => storeImage(storage, png, "image/png")));
  const keys = results.map(({ objectKey }) => objectKey);
  assert.equal(new Set(keys).size, 32);
  assert.deepEqual((await readdir(root)).sort(), [...keys].sort());
});

test("unsafe roots and object symlinks fail without exposing physical paths", async (t) => {
  const parent = await temporaryDirectory(t);
  const publicDirectory = path.join(parent, "frontend", "public");
  assert.throws(
    () => createPrivateFileStorage({
      rootDirectory: path.join(publicDirectory, "uploads"),
      maxFileBytes: 100,
      prohibitedPublicDirectories: [publicDirectory],
    }),
    (error) => error.code === "PUBLIC_STORAGE_ROOT" && !error.message.includes(parent),
  );

  const invalidRoot = path.join(parent, "not-a-directory");
  await writeFile(invalidRoot, "file");
  const invalidStorage = storageAt(invalidRoot);
  await assert.rejects(
    invalidStorage.initialize(),
    (error) => error.code === "STORAGE_UNAVAILABLE" && !error.message.includes(invalidRoot),
  );

  const root = path.join(parent, "private");
  const storage = storageAt(root);
  await storage.initialize();
  const outside = path.join(parent, "outside-secret");
  await writeFile(outside, "secret outside storage");
  try {
    await symlink(outside, path.join(root, keyA), "file");
  } catch (error) {
    if (error.code === "EPERM") {
      t.diagnostic("File symlinks are unavailable in this Windows environment");
      return;
    }
    throw error;
  }
  await assert.rejects(
    storage.openObject(keyA),
    (error) => error.code === "UNSAFE_OBJECT" && !error.message.includes(outside),
  );
});
