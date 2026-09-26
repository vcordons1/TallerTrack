const test = require("node:test");
const assert = require("node:assert/strict");

const { createReceptionPhoto, createUploadForm } = require("../src/features/reception/photoUpload.cjs");

class NativeFormData {
  parts = [];
  append(name, value) { this.parts.push([name, value]); }
}
class ExpoFile {
  constructor(uri) {
    this.uri = uri;
    this.name = uri.split("/").at(-1);
    this.type = this.name.endsWith(".png") ? "image/png" : "image/jpeg";
  }
  async bytes() { return new Uint8Array([1, 2, 3]); }
}

test("camera and gallery assets produce the native multipart context and file representation", async () => {
  const context = { vehiculoId: "7", propiedadEsperadaId: "9", propietarioEsperadoId: "5" };
  for (const [asset, expected] of [
    [{ uri: "file:///cache/camera.jpeg", mimeType: "image/jpeg" }, "image/jpeg"],
    [{ uri: "file:///cache/gallery.png", mimeType: "image/png" }, "image/png"],
    [{ uri: "file:///cache/converted.jpeg", mimeType: "image/heic" }, "image/jpeg"],
  ]) {
    const photo = createReceptionPhoto(asset);
    const form = createUploadForm(photo, context, ExpoFile, NativeFormData);
    assert.equal(form.parts.length, 2);
    assert.deepEqual(JSON.parse(form.parts[0][1]), { tipo: "RECEPCION_PREVIA", ...context });
    assert.equal(form.parts[0][0], "contexto");
    assert.equal(form.parts[1][0], "archivo");
    assert.equal(form.parts[1][1].uri, asset.uri);
    assert.equal(form.parts[1][1].type, expected);
    assert.match(form.parts[1][1].name, expected === "image/png" ? /\.png$/ : /\.jpeg$/);
    assert.deepEqual(await form.parts[1][1].bytes(), new Uint8Array([1, 2, 3]));
  }
});

test("unsupported picker output is rejected before upload", () => {
  assert.throws(() => createReceptionPhoto({ uri: "file:///cache/photo.webp", mimeType: "image/webp" }),
    (error) => error.code === "PHOTO_FORMAT_UNSUPPORTED");
  class MismatchedFile extends ExpoFile {
    get type() { return "image/png"; }
    set type(_value) {}
  }
  assert.throws(() => createUploadForm({ uri: "file:///cache/photo.jpeg", mimeType: "image/jpeg" },
    {}, MismatchedFile, NativeFormData), (error) => error.code === "PHOTO_FORMAT_UNSUPPORTED");
});
