import { createHash, randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

const SESSION_IDENTIFIER = /^[0-9a-f]{32}$/;
const POSITIVE_ID = /^[1-9][0-9]{0,17}$/;

export function createTokenService({ config, clock = () => new Date() }) {
  const key = new Uint8Array(config.signingKey);

  function createRefreshToken() {
    return randomBytes(32).toString("base64url");
  }

  function hashRefreshToken(value) {
    return createHash("sha256").update(value, "utf8").digest();
  }

  async function issueAccessToken({ userId, sessionIdentifier, credentialVersion }) {
    const nowSeconds = Math.floor(clock().getTime() / 1000);
    const expiresSeconds = nowSeconds + config.accessTtlSeconds;
    const accessToken = await new SignJWT({
      uid: String(userId),
      sid: sessionIdentifier,
      cv: String(credentialVersion),
    })
      .setProtectedHeader({ alg: config.algorithm, typ: "JWT" })
      .setIssuedAt(nowSeconds)
      .setExpirationTime(expiresSeconds)
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .sign(key);
    return Object.freeze({ accessToken, accessExpiresAt: new Date(expiresSeconds * 1000) });
  }

  async function verifyAccessToken(token) {
    const { payload, protectedHeader } = await jwtVerify(token, key, {
      algorithms: [config.algorithm],
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ["iat", "exp", "iss", "aud", "uid", "sid", "cv"],
      currentDate: clock(),
    });
    if (protectedHeader.typ !== "JWT"
      || typeof payload.uid !== "string" || !POSITIVE_ID.test(payload.uid)
      || typeof payload.cv !== "string" || !POSITIVE_ID.test(payload.cv)
      || typeof payload.sid !== "string" || !SESSION_IDENTIFIER.test(payload.sid)) {
      throw new Error("Invalid access token claims");
    }
    return Object.freeze({
      userId: payload.uid,
      sessionIdentifier: payload.sid,
      credentialVersion: payload.cv,
    });
  }

  return Object.freeze({
    createSessionIdentifier: () => randomBytes(16).toString("hex"),
    createRefreshToken,
    hashRefreshToken,
    issueAccessToken,
    verifyAccessToken,
  });
}
