import { describe, it, expect, beforeEach, vi } from "vitest";
import { setPrimaryUserRole, setSecondaryUserRoles, setUserAllowedViews, grantAdmin, revokeAdmin } from "./persistence";

// Migration 124 (the app_user_roles/workspace_member_roles compatibility
// bridge) routes all FIVE of the app's live role-management writers
// through new bridge_*() RPCs instead of writing app_user_roles/
// app_admins directly, so the RPC can atomically mirror each change into
// workspace_members/workspace_member_roles (or, for allowed_views, apply
// the same server-side validation) in one transaction. setUserAllowedViews
// was missed in the first draft of migration 124 -- this file now covers
// all five, matching the corrected migration. These tests lock in the
// FRONTEND half of that change -- that each function now calls the
// correct rpc/bridge_* endpoint with the correct body shape, and still
// surfaces a clear error on failure. The SQL side (authorization,
// atomicity, primary-role protection, the active-workspace guard,
// final-admin protection, and drift-report correctness) is covered by
// the transaction-safe SQL test script in
// backend/supabase/migration_124_bridge_tests.sql.

function mockFetchOk() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
}

function mockFetchFail(status: number) {
  return vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("setPrimaryUserRole", () => {
  it("calls rpc/bridge_set_primary_role with target_user_id and new_role_key", async () => {
    const fetchMock = mockFetchOk();
    globalThis.fetch = fetchMock;
    await setPrimaryUserRole("user-1", "pm", "token-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("rpc/bridge_set_primary_role");
    expect(JSON.parse(init.body)).toEqual({ target_user_id: "user-1", new_role_key: "pm" });
  });

  it("throws a clear error when the RPC call fails", async () => {
    globalThis.fetch = mockFetchFail(403);
    await expect(setPrimaryUserRole("user-1", "pm", "token-1")).rejects.toThrow(/Could not set primary role/);
  });
});

describe("setSecondaryUserRoles", () => {
  it("calls rpc/bridge_set_secondary_roles with target_user_id and the full role array", async () => {
    const fetchMock = mockFetchOk();
    globalThis.fetch = fetchMock;
    await setSecondaryUserRoles("user-1", ["warehouse", "purchasing"], "token-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("rpc/bridge_set_secondary_roles");
    expect(JSON.parse(init.body)).toEqual({ target_user_id: "user-1", new_role_keys: ["warehouse", "purchasing"] });
  });

  it("still sends an empty array when clearing all secondary roles (not skipped client-side)", async () => {
    const fetchMock = mockFetchOk();
    globalThis.fetch = fetchMock;
    await setSecondaryUserRoles("user-1", [], "token-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).new_role_keys).toEqual([]);
  });

  it("throws a clear error when the RPC call fails", async () => {
    globalThis.fetch = mockFetchFail(403);
    await expect(setSecondaryUserRoles("user-1", ["sales"], "token-1")).rejects.toThrow(/Could not set secondary roles/);
  });
});

describe("grantAdmin", () => {
  it("calls rpc/bridge_grant_admin with target_user_id", async () => {
    const fetchMock = mockFetchOk();
    globalThis.fetch = fetchMock;
    await grantAdmin("user-2", "token-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("rpc/bridge_grant_admin");
    expect(JSON.parse(init.body)).toEqual({ target_user_id: "user-2" });
  });

  it("throws a clear error when the RPC call fails", async () => {
    globalThis.fetch = mockFetchFail(403);
    await expect(grantAdmin("user-2", "token-1")).rejects.toThrow(/Could not grant admin/);
  });
});

describe("revokeAdmin", () => {
  it("calls rpc/bridge_revoke_admin with target_user_id", async () => {
    const fetchMock = mockFetchOk();
    globalThis.fetch = fetchMock;
    await revokeAdmin("user-2", "token-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("rpc/bridge_revoke_admin");
    expect(JSON.parse(init.body)).toEqual({ target_user_id: "user-2" });
  });

  it("throws a clear error when the RPC call fails", async () => {
    globalThis.fetch = mockFetchFail(403);
    await expect(revokeAdmin("user-2", "token-1")).rejects.toThrow(/Could not revoke admin/);
  });
});

describe("setUserAllowedViews", () => {
  it("calls rpc/bridge_set_user_allowed_views with target_user_id and new_allowed_views", async () => {
    const fetchMock = mockFetchOk();
    globalThis.fetch = fetchMock;
    await setUserAllowedViews("user-1", ["dashboard", "tasks"], "token-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("rpc/bridge_set_user_allowed_views");
    expect(JSON.parse(init.body)).toEqual({ target_user_id: "user-1", new_allowed_views: ["dashboard", "tasks"] });
  });

  it("sends null through unchanged when clearing tab overrides", async () => {
    const fetchMock = mockFetchOk();
    globalThis.fetch = fetchMock;
    await setUserAllowedViews("user-1", null, "token-1");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).new_allowed_views).toBeNull();
  });

  it("throws a clear error when the RPC call fails (e.g. missing/duplicate primary role)", async () => {
    globalThis.fetch = mockFetchFail(400);
    await expect(setUserAllowedViews("user-1", ["dashboard"], "token-1")).rejects.toThrow(/Could not update tab permissions/);
  });
});
