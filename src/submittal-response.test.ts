import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchPublicSubmittal, respondToPublicSubmittal } from "./persistence";

// Migration 122 fixed the submittal-response equivalent of migration
// 119/121's proposal-token replay/notification bugs: respond_to_submittal()
// had no server-side status-transition guard, and its notification insert
// used an ON CONFLICT clause that never matched notifications' real
// partial unique index. These tests lock in the FRONTEND half of that
// fix -- that fetchPublicSubmittal/respondToPublicSubmittal correctly map
// every one of the RPC's outcome shapes into a discriminated result the
// UI can act on. The SQL side (atomicity, concurrency, notification
// dedup) is covered by the transaction-safe SQL test script in
// PRODUCT_TOKEN_BACKUP_CONTENT_TEST_AUDIT.md.

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("fetchPublicSubmittal", () => {
  it("maps a real submittal to outcome 'found' with all fields, including the new respondedAt/approvalName", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      {
        submittal_id: "s1",
        status: "sent",
        version: 2,
        content_snapshot: { projectName: "Test Project", projectRef: "PRJ-2026-0001", clientName: "Test Client", siteAddress: "", targetDate: "", allocated: 0, sow: { summary: "", preparation: "", infrastructure: "", installation: "", commissioning: "", fineTuning: "", assumptions: "", exclusions: "" }, bom: [] },
        client_name: "Test Client",
        project_name: "Test Project",
        responded_at: null,
        approval_name: null,
      },
    ]);
    const result = await fetchPublicSubmittal("real-token");
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.data.status).toBe("sent");
      expect(result.data.respondedAt).toBeNull();
      expect(result.data.approvalName).toBeNull();
    }
  });

  it("maps an already-responded submittal's respondedAt/approvalName through correctly", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      {
        submittal_id: "s1",
        status: "approved",
        version: 1,
        content_snapshot: { projectName: "Test Project", projectRef: "", clientName: "", siteAddress: "", targetDate: "", allocated: 0, sow: { summary: "", preparation: "", infrastructure: "", installation: "", commissioning: "", fineTuning: "", assumptions: "", exclusions: "" }, bom: [] },
        client_name: "Test Client",
        project_name: "Test Project",
        responded_at: "2026-09-08T12:00:00Z",
        approval_name: "Jane Customer",
      },
    ]);
    const result = await fetchPublicSubmittal("real-token");
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.data.status).toBe("approved");
      expect(result.data.respondedAt).toBe("2026-09-08T12:00:00Z");
      expect(result.data.approvalName).toBe("Jane Customer");
    }
  });

  it("maps a well-formed but empty response (bad/expired token) to outcome 'invalid_token', not a bare null", async () => {
    globalThis.fetch = mockFetchOnce(200, []);
    const result = await fetchPublicSubmittal("bad-token");
    expect(result.outcome).toBe("invalid_token");
  });

  it("maps an HTTP failure to outcome 'error', distinct from 'invalid_token'", async () => {
    globalThis.fetch = mockFetchOnce(503, {});
    const result = await fetchPublicSubmittal("any-token");
    expect(result.outcome).toBe("error");
  });

  it("maps a network-level throw to outcome 'error' without rejecting the caller's promise", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await fetchPublicSubmittal("any-token");
    expect(result.outcome).toBe("error");
  });
});

describe("respondToPublicSubmittal", () => {
  it("maps a first, winning response to outcome 'success' with the real recorded state", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "success", status: "approved", responded_at: "2026-09-08T12:00:00Z", approval_name: "Jane Customer", version: 1 },
    ]);
    const result = await respondToPublicSubmittal("token", "approved", "Jane Customer", "");
    expect(result).toEqual({
      outcome: "success",
      status: "approved",
      respondedAt: "2026-09-08T12:00:00Z",
      approvalName: "Jane Customer",
      version: 1,
    });
  });

  it("maps a replay/concurrency-loser response to 'already_responded' with the ORIGINAL winner's state, not the replay attempt's own input", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "already_responded", status: "approved", responded_at: "2026-09-08T12:00:00Z", approval_name: "Jane Customer", version: 1 },
    ]);
    const result = await respondToPublicSubmittal("token", "rejected", "Someone Else", "trying again");
    expect(result.outcome).toBe("already_responded");
    expect(result.status).toBe("approved");
    expect(result.approvalName).toBe("Jane Customer");
  });

  it("maps an invalid-token response to outcome 'invalid_token' with null state", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "invalid_token", status: null, responded_at: null, approval_name: null, version: null },
    ]);
    const result = await respondToPublicSubmittal("bad-token", "approved", "Someone", "");
    expect(result.outcome).toBe("invalid_token");
    expect(result.status).toBeNull();
  });

  it("maps an HTTP failure to outcome 'error'", async () => {
    globalThis.fetch = mockFetchOnce(500, {});
    const result = await respondToPublicSubmittal("token", "approved", "Someone", "");
    expect(result.outcome).toBe("error");
  });

  it("maps a network-level throw to outcome 'error' without rejecting the caller's promise", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await respondToPublicSubmittal("token", "approved", "Someone", "");
    expect(result.outcome).toBe("error");
  });

  it("treats an unrecognized outcome string from a future/mismatched RPC version as 'error' rather than crashing", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "some_future_outcome_this_client_does_not_know_about", status: "approved", responded_at: null, approval_name: null, version: 1 },
    ]);
    const result = await respondToPublicSubmittal("token", "approved", "Someone", "");
    expect(result.outcome).toBe("error");
  });
});
