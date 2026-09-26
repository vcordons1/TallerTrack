const MIME_BY_EXTENSION = Object.freeze({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" });

function photoMimeType(asset) {
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(asset?.uri || "")?.[1]?.toLowerCase();
  const mimeType = MIME_BY_EXTENSION[extension] || asset?.mimeType?.toLowerCase();
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
    const error = new Error("El formato de la fotografía no es admitido. Usa JPEG o PNG.");
    error.code = "PHOTO_FORMAT_UNSUPPORTED";
    throw error;
  }
  return mimeType;
}

function createReceptionPhoto(asset) {
  if (!asset?.uri) throw new TypeError("A local photograph URI is required");
  const mimeType = photoMimeType(asset);
  return { uri: asset.uri, mimeType };
}

function createUploadForm(photo, context, FileConstructor, FormDataConstructor = FormData) {
  const selected = createReceptionPhoto(photo);
  const file = new FileConstructor(selected.uri);
  if (file.type !== selected.mimeType) {
    const error = new Error("El formato de la fotografía no es admitido. Usa JPEG o PNG.");
    error.code = "PHOTO_FORMAT_UNSUPPORTED";
    throw error;
  }
  const form = new FormDataConstructor();
  form.append("contexto", JSON.stringify({ tipo: "RECEPCION_PREVIA", ...context }));
  // Expo's fetch converts File bytes; it rejects React Native's { uri, name, type } part.
  form.append("archivo", file);
  return form;
}

module.exports = { createReceptionPhoto, createUploadForm };
