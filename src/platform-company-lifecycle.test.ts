import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadPlatformWorkspaces, suspendCompany, reactivateCompany } from "./persistence";

// Migration 198's own review, item 10: focused regression tests for the
// Ergon Platform console's company-lifecycle calls, matching this repo's
// established write-verification test convention (see
// company-signup-lifecycle.test.ts et al.).

function respond(ok: boolean, status: number, body: unknown) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("loadPlatformWorkspaces -- item 4: a failed load must never look like an empty company list", () => {
  it("maps a successful response into PlatformWorkspace rows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(true, 200, [{ id: "ws-1", name: "Acme Co", slug: "acme-co", status: "active", created_at: "2026-09-22T00:00:00Z" }]),
    );
    const result = await loadPlatformWorkspaces("token-abc");
    expect(result).toEqual([{ id: "ws-1", name: "Acme Co", slug: "acme-co", status: "active", createdAt: "2026-09-22T00:00:00Z" }]);
  });

  it("resolves to an empty array for a genuinely empty platform (zero rows, ok response)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    const result = await loadPlatformWorkspaces("token-abc");
    expect(result).toEqual([]);
  });

  it("throws with the real error detail on a non-ok response -- never silently returns [] for a genuine failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db connection reset" }));
    await expect(loadPlatformWorkspaces("token-abc")).rejects.toThrow("db connection reset");
  });

  it("resolves to [] (not configured / no session) rather than throwing when there is no access token", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const result = await loadPlatformWorkspaces(undefined);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("suspendCompany -- items 5/8/9", () => {
  it("posts the workspace id, reason, and confirmOwnWorkspace flag to rpc/suspend_company", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, {}));
    globalThis.fetch = fetchMock;
    await suspendCompany("ws-1", "Non-payment", false, "token-abc");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("rpc/suspend_company");
    expect(JSON.parse(init.body)).toEqual({ p_workspace_id: "ws-1", p_reason: "Non-payment", p_confirm_own_workspace: false });
  });

  it("succeeds silently on a 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, {}));
    await expect(suspendCompany("ws-1", "Non-payment", false, "token-abc")).resolves.toBeUndefined();
  });

  it("surfaces the real error detail on rejection", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 400, { message: "A reason is required to suspend a company" }));
    await expect(suspendCompany("ws-1", "", false, "token-abc")).rejects.toThrow("A reason is required to suspend a company");
  });

  it("passes the OWN_WORKSPACE_CONFIRMATION_REQUIRED signal through unchanged so the caller can detect it", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(false, 400, { message: "OWN_WORKSPACE_CONFIRMATION_REQUIRED: this is your own active company -- pass explicit confirmation to suspend it anyway" }),
    );
    await expect(suspendCompany("ws-1", "oops", false, "token-abc")).rejects.toThrow("OWN_WORKSPACE_CONFIRMATION_REQUIRED");
  });

  it("throws when called with no access token, never calling fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(suspendCompany("ws-1", "reason", false, undefined)).rejects.toThrow("Not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reactivateCompany -- item 5", () => {
  it("posts the workspace id and reason to rpc/reactivate_company", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, {}));
    globalThis.fetch = fetchMock;
    await reactivateCompany("ws-1", "Payment received", "token-abc");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("rpc/reactivate_company");
    expect(JSON.parse(init.body)).toEqual({ p_workspace_id: "ws-1", p_reason: "Payment received" });
  });

  it("succeeds silently on a 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, {}));
    await expect(reactivateCompany("ws-1", "Payment received", "token-abc")).resolves.toBeUndefined();
  });

  it("surfaces the real error detail on rejection", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 400, { message: "Company is not suspended (current status: active) -- nothing to reactivate" }));
    await expect(reactivateCompany("ws-1", "reason", "token-abc")).rejects.toThrow("nothing to reactivate");
  });

  it("throws when called with no access token, never calling fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(reactivateCompany("ws-1", "reason", undefined)).rejects.toThrow("Not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
