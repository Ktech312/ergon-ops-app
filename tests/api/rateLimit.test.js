import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// api/_lib/rateLimit.js decides in-memory vs. durable (Redis) ONCE, at
// module load, based on whether UPSTASH_REDIS_REST_URL/_TOKEN are set --
// so each scenario below needs a fresh module instance (vi.resetModules
// + a fresh dynamic import) taken AFTER setting/clearing those env vars,
// not a single shared import at the top of the file.

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.doUnmock("@upstash/redis");
});

describe("rateLimit: no durable store configured", () => {
  it("falls back to the original in-memory limiter and still enforces the count", async () => {
    const { checkRateLimit } = await import("../../api/_lib/rateLimit.js");
    const key = `test-in-memory-${Date.now()}`;
    expect(await checkRateLimit(key, 2, 60_000)).toBe(true);
    expect(await checkRateLimit(key, 2, 60_000)).toBe(true);
    // Third call within the same window exceeds maxCount=2.
    expect(await checkRateLimit(key, 2, 60_000)).toBe(false);
  });

  it("keys are independent -- a different caller/route is never blocked by someone else's count", async () => {
    const { checkRateLimit } = await import("../../api/_lib/rateLimit.js");
    const keyA = `test-a-${Date.now()}`;
    const keyB = `test-b-${Date.now()}`;
    expect(await checkRateLimit(keyA, 1, 60_000)).toBe(true);
    expect(await checkRateLimit(keyA, 1, 60_000)).toBe(false);
    // keyB has never been hit -- must still be allowed.
    expect(await checkRateLimit(keyB, 1, 60_000)).toBe(true);
  });
});

describe("rateLimit: durable store (Upstash Redis) configured", () => {
  it("uses INCR/EXPIRE against Redis, not the in-memory bucket, and enforces the count durably", async () => {
    const state = new Map();
    const incr = vi.fn(async (key) => {
      const next = (state.get(key) || 0) + 1;
      state.set(key, next);
      return next;
    });
    const expire = vi.fn(async () => 1);
    vi.doMock("@upstash/redis", () => ({
      Redis: class {
        incr = incr;
        expire = expire;
      },
    }));
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-upstash-token";

    const { checkRateLimit } = await import("../../api/_lib/rateLimit.js");
    const key = "test-redis-caller";
    expect(await checkRateLimit(key, 2, 60_000)).toBe(true);
    expect(await checkRateLimit(key, 2, 60_000)).toBe(true);
    expect(await checkRateLimit(key, 2, 60_000)).toBe(false);
    expect(incr).toHaveBeenCalledTimes(3);
    // expire is set once, only on the call that actually created the key.
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("two separate warm instances sharing the same Redis-backed key see each other's counts (the whole point of durability)", async () => {
    // Simulates two cold-started function instances by importing the
    // module twice (fresh in-memory `buckets` each time, exactly like two
    // real Vercel invocations that never share process memory) against
    // the SAME backing Redis state.
    const state = new Map();
    const incr = vi.fn(async (key) => {
      const next = (state.get(key) || 0) + 1;
      state.set(key, next);
      return next;
    });
    const expire = vi.fn(async () => 1);
    vi.doMock("@upstash/redis", () => ({
      Redis: class {
        incr = incr;
        expire = expire;
      },
    }));
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-upstash-token";

    const instanceOne = await import("../../api/_lib/rateLimit.js");
    vi.resetModules();
    const instanceTwo = await import("../../api/_lib/rateLimit.js");

    const key = "test-shared-key";
    expect(await instanceOne.checkRateLimit(key, 2, 60_000)).toBe(true);
    expect(await instanceTwo.checkRateLimit(key, 2, 60_000)).toBe(true);
    // Third request, on a THIRD simulated instance, still sees the real
    // total (2) from the other two and correctly gets blocked -- this is
    // exactly the case the old in-memory-only limiter could never catch.
    vi.resetModules();
    const instanceThree = await import("../../api/_lib/rateLimit.js");
    expect(await instanceThree.checkRateLimit(key, 2, 60_000)).toBe(false);
  });

  it("fails open to the in-memory limiter for that call if Redis errors, instead of blocking real traffic", async () => {
    const incr = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const expire = vi.fn(async () => 1);
    vi.doMock("@upstash/redis", () => ({
      Redis: class {
        incr = incr;
        expire = expire;
      },
    }));
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-upstash-token";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { checkRateLimit } = await import("../../api/_lib/rateLimit.js");
    // Redis is broken, but the in-memory fallback still allows a first
    // request through rather than the whole route failing.
    expect(await checkRateLimit("test-redis-down", 5, 60_000)).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    const loggedText = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedText).toContain("Durable check failed");
    // Never log anything that could be mistaken for the Upstash token.
    expect(loggedText).not.toContain("test-upstash-token");
    errorSpy.mockRestore();
  });
});
