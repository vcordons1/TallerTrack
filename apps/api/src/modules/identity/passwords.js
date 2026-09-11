import argon2 from "argon2";

export const ARGON2ID_PROFILE = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});

export function createPasswordService({ implementation = argon2 } = {}) {
  return Object.freeze({
    hash(password) {
      return implementation.hash(password, ARGON2ID_PROFILE);
    },
    verify(encodedHash, password) {
      return implementation.verify(encodedHash, password, { type: argon2.argon2id });
    },
  });
}

export async function measurePasswordProfile({ passwordService = createPasswordService(), samples = 3 } = {}) {
  const durationsMs = [];
  for (let index = 0; index < samples; index += 1) {
    const started = process.hrtime.bigint();
    await passwordService.hash(`profile-measurement-${index}`);
    durationsMs.push(Number(process.hrtime.bigint() - started) / 1_000_000);
  }
  return Object.freeze({
    profile: ARGON2ID_PROFILE,
    samples: Object.freeze(durationsMs),
    averageMs: durationsMs.reduce((sum, value) => sum + value, 0) / durationsMs.length,
  });
}
