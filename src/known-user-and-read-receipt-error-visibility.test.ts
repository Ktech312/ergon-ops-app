import { describe, it, expect, beforeEach, vi } from "vitest";
import { upsertKnownUser, markConversationRead } from "./persistence";

// Overnight audit (2026-09-08) found both functions previously never
// checked response.ok at all -- since fetch() only rejects on network
// failure, an HTTP failure (401/500/etc.) resolved normally and was
// silently indistinguishable from success, with zero signal anywhere.
// These tests lock in the fix: both still stay fire-and-forget /
// best-effort from the caller's perspective (neither throws on an HTTP
// failure -- that would be a bigger, riskier behavior change to every
// existing call site), but a real failure is now at least logged instead
// of vanishing completely.

function mockFetchFail(status: number) {
  return vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("upsertKnownUser", () => {
  it("does not throw on an HTTP failure (stays best-effort)", async () => {
    globalThis.fetch = mockFetchFail(500);
    await expect(upsertKnownUser("user-1", "test@example.com", "token-1")).resolves.toBeUndefined();
  });

  it("logs an HTTP failure instead of silently doing nothing", async () => {
    globalThis.fetch = mockFetchFail(500);
    await upsertKnownUser("user-1", "test@example.com", "token-1");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("upsertKnownUser failed for user-1"));
  });

  it("does not throw on a network failure and still logs it", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(upsertKnownUser("user-1", "test@example.com", "token-1")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("upsertKnownUser network error for user-1"), expect.any(Error));
  });
});

describe("markConversationRead", () => {
  it("does not throw on an HTTP failure (stays best-effort)", async () => {
    globalThis.fetch = mockFetchFail(401);
    await expect(markConversationRead("conv-1", "user-1", "token-1")).resolves.toBeUndefined();
  });

  it("logs an HTTP failure instead of silently doing nothing", async () => {
    globalThis.fetch = mockFetchFail(401);
    await markConversationRead("conv-1", "user-1", "token-1");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("markConversationRead failed for conversation conv-1"));
  });

  it("does not log anything on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ([]) });
    await markConversationRead("conv-1", "user-1", "token-1");
    expect(console.error).not.toHaveBeenCalled();
  });
});
