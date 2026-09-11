import assert from "node:assert/strict";
import test from "node:test";

import { ARGON2ID_PROFILE, createPasswordService } from "../src/modules/identity/passwords.js";

test("Argon2id profile is explicit, salted and verifies real passwords", async () => {
  const service = createPasswordService();
  const password = "Correct horse battery staple";
  const first = await service.hash(password);
  const second = await service.hash(password);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.match(first, /^\$argon2id\$v=19\$m=65536,p=1,t=3\$/);
  assert.equal(await service.verify(first, password), true);
  assert.equal(await service.verify(first, "incorrect"), false);
  assert.deepEqual(
    { memoryCost: ARGON2ID_PROFILE.memoryCost, timeCost: ARGON2ID_PROFILE.timeCost,
      parallelism: ARGON2ID_PROFILE.parallelism, hashLength: ARGON2ID_PROFILE.hashLength },
    { memoryCost: 65_536, timeCost: 3, parallelism: 1, hashLength: 32 },
  );
});
