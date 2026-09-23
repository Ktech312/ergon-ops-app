import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadSupportCases,
  loadSupportCaseActivity,
  loadLedgerEligibleProjects,
  createSupportCase,
  addSupportCaseActivity,
  changeSupportCaseStatus,
  reopenSupportCase,
  assignSupportCaseOwner,
} from "./persistence";

// Support module, first release (migration 200, decision D13). Focused
// regression tests for the persistence.ts layer, matching this repo's
// established write-verification test convention. Deliberately NOT a
// rendered-component test of SupportCasesPage/NewSupportCaseModal/
// SupportCaseDetailModal -- main.tsx executes a real
// createRoot(...).render(...) at module scope, so importing it in a test
// at all would attempt a real DOM render immediately (same constraint
// documented in auth-session-persistence.test.ts). The UI itself was
// verified live in production after deploy.

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

describe("loadSupportCases / loadSupportCaseActivity -- a failed load must never look like an empty list", () => {
  it("maps a successful support_cases response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(true, 200, [
        {
          id: "case-1",
          workspace_id: "ws-1",
          case_number: "SC-2026-0001",
          project_id: "proj-1",
          status: "open",
          priority: "high",
          sla_due_at: null,
          owner_workspace_member_id: null,
          summary: "Entry point down",
          created_by_email: "pm@example.com",
          created_at: "2026-09-23T00:00:00Z",
          updated_at: "2026-09-23T00:00:00Z",
          resolved_at: null,
          closed_at: null,
        },
      ]),
    );
    const result = await loadSupportCases("token-abc");
    expect(result).toEqual([
      {
        id: "case-1",
        workspaceId: "ws-1",
        caseNumber: "SC-2026-0001",
        projectId: "proj-1",
        status: "open",
        priority: "high",
        slaDueAt: null,
        ownerWorkspaceMemberId: null,
        summary: "Entry point down",
        createdByEmail: "pm@example.com",
        createdAt: "2026-09-23T00:00:00Z",
        updatedAt: "2026-09-23T00:00:00Z",
        resolvedAt: null,
        closedAt: null,
      },
    ]);
  });

  it("throws (never returns []) when the request fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db down" }));
    await expect(loadSupportCases("token-abc")).rejects.toThrow("db down");
  });

  it("resolves to [] with no access token, rather than throwing", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const result = await loadSupportCases(undefined);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loadSupportCaseActivity maps qty as a real number, not a string", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(true, 200, [
        {
          id: "act-1",
          support_case_id: "case-1",
          kind: "parts_used",
          body: "Replaced unit",
          actor_email: "pm@example.com",
          occurred_at: "2026-09-23T00:00:00Z",
          previous_status: null,
          new_status: null,
          inventory_item_id: "item-1",
          qty: "2.00",
        },
      ]),
    );
    const result = await loadSupportCaseActivity("case-1", "token-abc");
    expect(result[0].qty).toBe(2);
    expect(typeof result[0].qty).toBe("number");
  });

  it("loadSupportCaseActivity throws (never returns []) when the request fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db down" }));
    await expect(loadSupportCaseActivity("case-1", "token-abc")).rejects.toThrow("db down");
  });
});

describe("loadLedgerEligibleProjects", () => {
  it("maps project_name/customer_name", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, [{ id: "proj-1", project_name: "Acme Garage", customer_name: "Acme Co" }]));
    const result = await loadLedgerEligibleProjects("token-abc");
    expect(result).toEqual([{ id: "proj-1", projectName: "Acme Garage", customerName: "Acme Co" }]);
  });

  it("resolves to [] on a failed request (this is a picker list, not a status-of-truth loader)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, {}));
    const result = await loadLedgerEligibleProjects("token-abc");
    expect(result).toEqual([]);
  });
});

describe("createSupportCase", () => {
  it("posts the expected RPC body shape, including null defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respond(true, 200, {
        id: "case-1",
        workspace_id: "ws-1",
        case_number: "SC-2026-0001",
        project_id: "proj-1",
        status: "open",
        priority: "normal",
        sla_due_at: null,
        owner_workspace_member_id: null,
        summary: "Issue",
        created_by_email: "pm@example.com",
        created_at: "2026-09-23T00:00:00Z",
        updated_at: "2026-09-23T00:00:00Z",
        resolved_at: null,
        closed_at: null,
      }),
    );
    globalThis.fetch = fetchMock;
    await createSupportCase({ projectId: "proj-1", summary: "Issue", priority: "normal" }, "token-abc");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("rpc/create_support_case");
    expect(JSON.parse(init.body)).toEqual({
      p_project_id: "proj-1",
      p_summary: "Issue",
      p_priority: "normal",
      p_owner_workspace_member_id: null,
      p_installed_asset_ids: null,
    });
  });

  it("omits an empty installedAssetIds array as null, not []", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, { id: "case-1" }));
    globalThis.fetch = fetchMock;
    await createSupportCase({ projectId: "proj-1", summary: "Issue", priority: "normal", installedAssetIds: [] }, "token-abc");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.p_installed_asset_ids).toBeNull();
  });

  it("surfaces the real error detail on rejection (e.g. project not on the Client Ledger)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(false, 400, { message: "Support cases can only be created from a project already added to the Client Ledger" }),
    );
    await expect(createSupportCase({ projectId: "proj-1", summary: "Issue", priority: "normal" }, "token-abc")).rejects.toThrow("Client Ledger");
  });

  it("throws when called with no access token, never calling fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(createSupportCase({ projectId: "proj-1", summary: "Issue", priority: "normal" }, undefined)).rejects.toThrow("Not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("addSupportCaseActivity", () => {
  it("posts the expected RPC body for a plain note", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respond(true, 200, { id: "act-1", support_case_id: "case-1", kind: "note", body: "Called back", actor_email: "pm@example.com", occurred_at: "2026-09-23T00:00:00Z", previous_status: null, new_status: null, inventory_item_id: null, qty: null }),
    );
    globalThis.fetch = fetchMock;
    await addSupportCaseActivity({ supportCaseId: "case-1", kind: "note", body: "Called back" }, "token-abc");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ p_support_case_id: "case-1", p_kind: "note", p_body: "Called back", p_occurred_at: null, p_inventory_item_id: null, p_qty: null });
  });

  it("rejects status_change/reopened with the real server error, matching the RPC's own guard", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(false, 400, { message: "Use change_support_case_status()/reopen_support_case() for status transitions, not add_support_case_activity()" }),
    );
    await expect(
      addSupportCaseActivity({ supportCaseId: "case-1", kind: "note" as never, body: "x" }, "token-abc"),
    ).rejects.toThrow("change_support_case_status");
  });
});

describe("changeSupportCaseStatus / reopenSupportCase / assignSupportCaseOwner", () => {
  it("changeSupportCaseStatus posts the expected body, empty note becomes null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, { id: "case-1", status: "in_progress" }));
    globalThis.fetch = fetchMock;
    await changeSupportCaseStatus("case-1", "in_progress", "", "token-abc");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ p_support_case_id: "case-1", p_new_status: "in_progress", p_note: null });
  });

  it("changeSupportCaseStatus surfaces a rejected invalid transition", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 400, { message: "Cannot move a resolved case to open" }));
    await expect(changeSupportCaseStatus("case-1", "open", "", "token-abc")).rejects.toThrow("Cannot move a resolved case to open");
  });

  it("reopenSupportCase posts the expected body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, { id: "case-1", status: "reopened" }));
    globalThis.fetch = fetchMock;
    await reopenSupportCase("case-1", "Client reports it broke again.", "token-abc");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("rpc/reopen_support_case");
    expect(JSON.parse(init.body)).toEqual({ p_support_case_id: "case-1", p_note: "Client reports it broke again." });
  });

  it("assignSupportCaseOwner posts the expected body, including explicitly unassigning (null)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, { id: "case-1", owner_workspace_member_id: null }));
    globalThis.fetch = fetchMock;
    await assignSupportCaseOwner("case-1", null, "token-abc");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ p_support_case_id: "case-1", p_owner_workspace_member_id: null });
  });

  it("assignSupportCaseOwner surfaces a rejected cross-workspace owner id", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 400, { message: "Owner not found in this workspace" }));
    await expect(assignSupportCaseOwner("case-1", "member-from-another-workspace", "token-abc")).rejects.toThrow("Owner not found in this workspace");
  });
});
