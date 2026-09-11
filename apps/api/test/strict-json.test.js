import assert from "node:assert/strict";
import test from "node:test";

import { parseStrictJsonObject } from "../src/platform/strict-json.js";

test("strict JSON accepts an object and rejects duplicate keys at any depth", () => {
  assert.deepEqual(parseStrictJsonObject('{"login":"a","nested":{"ok":true}}'), {
    login: "a", nested: { ok: true },
  });
  assert.throws(() => parseStrictJsonObject('{"login":"a","login":"b"}'), /Duplicate/);
  assert.throws(() => parseStrictJsonObject('{"nested":{"role":"A","role":"R"}}'), /Duplicate/);
  assert.throws(() => parseStrictJsonObject("[]"), /object/);
  assert.throws(() => parseStrictJsonObject('{"unterminated":'), SyntaxError);
});
