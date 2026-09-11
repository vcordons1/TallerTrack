import { open } from "node:fs/promises";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import sharp from "sharp";

const FORMATS = Object.freeze({
  jpeg: Object.freeze({ mimeType: "image/jpeg", signature: Buffer.from([0xff, 0xd8, 0xff]), trailer: Buffer.from([0xff, 0xd9]) }),
  png: Object.freeze({
    mimeType: "image/png",
    signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trailer: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
  }),
});

export class ImageValidationError extends Error {
  constructor(reason, message, options) {
    super(message, options);
    this.name = "ImageValidationError";
    this.code = "IMAGE_VALIDATION_FAILED";
    this.reason = reason;
  }
}

function reject(code, message, cause) {
  return new ImageValidationError(code, message, cause === undefined ? undefined : { cause });
}

function normalizedMimeType(declaredMimeType) {
  if (typeof declaredMimeType !== "string") return "";
  return declaredMimeType.split(";", 1)[0].trim().toLowerCase();
}

async function matchesBoundaries(filePath, size, profile) {
  if (size < profile.signature.length + profile.trailer.length) return false;
  const handle = await open(filePath, "r");
  try {
    const signature = Buffer.alloc(profile.signature.length);
    const trailer = Buffer.alloc(profile.trailer.length);
    await handle.read(signature, 0, signature.length, 0);
    await handle.read(trailer, 0, trailer.length, size - trailer.length);
    return signature.equals(profile.signature) && trailer.equals(profile.trailer);
  } finally {
    await handle.close();
  }
}

export function createTechnicalImageValidator({ maxPixels, maxDimension } = {}) {
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1
    || !Number.isSafeInteger(maxDimension) || maxDimension < 1) {
    throw new TypeError("Technical image validation limits are invalid");
  }

  return async function validateTechnicalImage(filePath, { size, declaredMimeType } = {}) {
    let metadata;
    try {
      metadata = await sharp(filePath, { failOn: "error", limitInputPixels: maxPixels, sequentialRead: true }).metadata();
    } catch (error) {
      throw reject("CORRUPT_OR_UNSUPPORTED_IMAGE", "The file is not a decodable JPEG or PNG image", error);
    }

    const profile = FORMATS[metadata.format];
    if (profile === undefined) {
      throw reject("UNSUPPORTED_IMAGE_FORMAT", "Only JPEG and PNG images are accepted");
    }
    if (normalizedMimeType(declaredMimeType) !== profile.mimeType) {
      throw reject("MIME_TYPE_MISMATCH", "The declared content type does not match the image bytes");
    }
    if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height)
      || metadata.width < 1 || metadata.height < 1) {
      throw reject("INVALID_IMAGE_DIMENSIONS", "The image dimensions are invalid");
    }
    const pixels = metadata.width * metadata.height;
    if (metadata.width > maxDimension || metadata.height > maxDimension || pixels > maxPixels) {
      throw reject("IMAGE_DIMENSIONS_EXCEEDED", "The image exceeds the configured dimension limits");
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw reject("MULTI_PAGE_IMAGE_UNSUPPORTED", "Multi-page or animated images are not accepted");
    }
    if (!(await matchesBoundaries(filePath, size, profile))) {
      throw reject("INVALID_IMAGE_BOUNDARIES", "The image is corrupt or contains trailing content");
    }

    try {
      await pipeline(
        sharp(filePath, { failOn: "error", limitInputPixels: maxPixels, sequentialRead: true }).raw(),
        new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
      );
    } catch (error) {
      throw reject("CORRUPT_IMAGE_DATA", "The image pixels could not be decoded", error);
    }

    return Object.freeze({
      mimeType: profile.mimeType,
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      pixels,
    });
  };
}
