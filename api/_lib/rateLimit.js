// Durable rate limiting (HANDOFF Questions/Decisions item 11, upgraded
// 2026-09-08). E: "replace the in-memory rate limiter with durable rate
// limiting so protection survives serverless cold starts and multiple
// Vercel instances." Backed by Upstash Redis (a REST-based client -- no
// persistent TCP connection to manage, the right fit for a serverless
// function that may live for one request) when `UPSTASH_REDIS_REST_URL`/
// `UPSTASH_REDIS_REST_TOKEN` are set. Same honest-fallback pattern as
// every other optional integration in this app (send-push.js's VAPID
// keys, etc.): with no store connected, this silently keeps working
// exactly as it always has -- the original in-memory-per-warm-instance
// limiter below, unchanged -- rather than either failing closed (blocking
// real traffic) or failing open with no limit at all.
//
// Algorithm: a fixed window, one key per (rate-limit key, window index),
// via Redis INCR + EXPIRE. Simple and atomic (INCR is a single Redis
// operation), durable and shared across every instance/region/cold start
// since the count lives in Redis, not process memory. The one honest
// trade-off of a fixed window (vs. a sliding one): a caller can get up to
// ~2x `maxCount` requests through across a window boundary (e.g. maxing
// out the last second of one window and the first second of the next).
// Not worth the extra Redis round-trips a true sliding window needs for
// the abuse pattern this is actually guarding against (a runaway script
// or retry loop, not a precisely-timed attacker) -- see HANDOFF.md.
import { Redis } from "@upstash/redis";

let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

// The original per-warm-instance limiter -- kept as-is, used whenever
// Redis isn't configured, and as the fallback if a configured Redis is
// unreachable (see the catch block below). Never log or otherwise expose
// `key` beyond what the caller already logs themselves -- it's built from
// a route name + the caller's own user id, not a secret, but still not
// this module's business to print.
const buckets = new Map();
function checkRateLimitInMemory(key, maxCount, windowMs) {
  const now = Date.now();
  const existing = buckets.get(key) || [];
  const recent = existing.filter((timestamp) => now - timestamp < windowMs);
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 500) {
    for (const [bucketKey, timestamps] of buckets) {
      if (timestamps.every((timestamp) => now - timestamp >= windowMs)) {
        buckets.delete(bucketKey);
      }
    }
  }
  return recent.length <= maxCount;
}

export async function checkRateLimit(key, maxCount, windowMs) {
  if (!redis) {
    return checkRateLimitInMemory(key, maxCount, windowMs);
  }
  try {
    const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    const windowIndex = Math.floor(Date.now() / windowMs);
    const bucketKey = `ratelimit:${key}:${windowIndex}`;
    const count = await redis.incr(bucketKey);
    if (count === 1) {
      // Only the request that actually creates the key sets its expiry --
      // an unconditional EXPIRE on every call would race harmlessly but
      // pointlessly extend a key's life on every hit instead of letting it
      // expire with the window it belongs to.
      await redis.expire(bucketKey, windowSeconds);
    }
    return count <= maxCount;
  } catch (error) {
    // Upstash unreachable/erroring -- fail open to the in-memory limiter
    // for this one call rather than either blocking real traffic or (the
    // worse failure mode) silently applying no rate limit at all.
    console.error(`[rateLimit] Durable check failed, falling back to in-memory for this call: ${error instanceof Error ? error.message : error}`);
    return checkRateLimitInMemory(key, maxCount, windowMs);
  }
}
