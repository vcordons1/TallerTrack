import { createHash } from "node:crypto";

export function createLoginRateLimit({ maximumAttempts, windowSeconds, capacity, clock = Date.now }) {
  const buckets = new Map();

  function keyFor(ip, login) {
    return createHash("sha256").update(`${ip}\0${login}`).digest("hex");
  }

  function prune(now) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    while (buckets.size >= capacity) buckets.delete(buckets.keys().next().value);
  }

  return Object.freeze({
    consume(ip, login) {
      const now = clock();
      prune(now);
      const key = keyFor(ip, login);
      const current = buckets.get(key);
      if (current === undefined) {
        buckets.set(key, { attempts: 1, resetAt: now + windowSeconds * 1000 });
        return Object.freeze({ allowed: true, retryAfterSeconds: 0 });
      }
      if (current.attempts >= maximumAttempts) {
        return Object.freeze({
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        });
      }
      current.attempts += 1;
      return Object.freeze({ allowed: true, retryAfterSeconds: 0 });
    },
    clear(ip, login) {
      buckets.delete(keyFor(ip, login));
    },
  });
}
