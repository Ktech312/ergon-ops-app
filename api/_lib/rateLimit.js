// Best-effort, in-memory-per-warm-instance rate limiting -- deliberately
// not a durable, cross-instance limiter (that needs external state like
// Vercel KV/Upstash, not currently provisioned; see HANDOFF.md). Vercel
// serverless functions reuse a warm container across nearby invocations
// from the same region, so this genuinely blunts a rapid-fire script or
// runaway retry loop from one caller in the common case, but a caller
// spread across multiple cold starts or edge regions can exceed it.
// Treated as one real, honest layer of abuse protection, not the whole
// story -- content-length caps and identity/relationship checks upstream
// of this are the primary defenses.
const buckets = new Map();

export function checkRateLimit(key, maxCount, windowMs) {
  const now = Date.now();
  const existing = buckets.get(key) || [];
  const recent = existing.filter((timestamp) => now - timestamp < windowMs);
  recent.push(now);
  buckets.set(key, recent);
  // Occasional cleanup so `buckets` doesn't grow unbounded across a long
  // warm-instance lifetime -- cheap, only runs when a key is actually hit.
  if (buckets.size > 500) {
    for (const [bucketKey, timestamps] of buckets) {
      if (timestamps.every((timestamp) => now - timestamp >= windowMs)) {
        buckets.delete(bucketKey);
      }
    }
  }
  return recent.length <= maxCount;
}
