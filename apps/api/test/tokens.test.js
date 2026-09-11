import assert from "node:assert/strict";
import test from "node:test";

import { createTokenService } from "../src/modules/identity/tokens.js";

const now = new Date("2026-09-11T12:00:00.000Z");
const baseConfig = {
  signingKey: Buffer.alloc(32, 0x42), algorithm: "HS256",
  issuer: "tallertrack-test", audience: "tallertrack-api", accessTtlSeconds: 600,
};

test("access JWT contains only minimal custom claims and enforces algorithm, issuer and audience", async () => {
  const service = createTokenService({ config: baseConfig, clock: () => now });
  const issued = await service.issueAccessToken({
    userId: "12", sessionIdentifier: "a".repeat(32), credentialVersion: "3",
  });
  assert.deepEqual(await service.verifyAccessToken(issued.accessToken), {
    userId: "12", sessionIdentifier: "a".repeat(32), credentialVersion: "3",
  });
  const payload = JSON.parse(Buffer.from(issued.accessToken.split(".")[1], "base64url"));
  assert.deepEqual(Object.keys(payload).sort(), ["aud", "cv", "exp", "iat", "iss", "sid", "uid"]);
  await assert.rejects(
    createTokenService({ config: { ...baseConfig, issuer: "wrong" }, clock: () => now })
      .verifyAccessToken(issued.accessToken),
  );
  await assert.rejects(
    createTokenService({ config: { ...baseConfig, audience: "wrong" }, clock: () => now })
      .verifyAccessToken(issued.accessToken),
  );
  const pieces = issued.accessToken.split(".");
  pieces[1] = `${pieces[1].slice(0, -1)}${pieces[1].endsWith("a") ? "b" : "a"}`;
  await assert.rejects(service.verifyAccessToken(pieces.join(".")));
});

test("access JWT expires and refresh secrets are opaque, random and hashed", async () => {
  let current = now;
  const service = createTokenService({ config: baseConfig, clock: () => current });
  const issued = await service.issueAccessToken({
    userId: "12", sessionIdentifier: "b".repeat(32), credentialVersion: "1",
  });
  current = new Date(now.getTime() + 601_000);
  await assert.rejects(service.verifyAccessToken(issued.accessToken));
  const first = service.createRefreshToken();
  const second = service.createRefreshToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(service.hashRefreshToken(first).length, 32);
  assert.equal(service.hashRefreshToken(first).includes(first), false);
});
