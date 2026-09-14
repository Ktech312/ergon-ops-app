import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchPublicQuoteProposal, respondToPublicQuoteProposal } from "./persistence";

// Migration 119 fixed a live proposal-token replay vulnerability:
// respond_to_quote_proposal() had no server-side status-transition guard,
// so a token holder could call the RPC directly and repeatedly flip an
// already-answered proposal. These tests lock in the FRONTEND half of
// that fix -- that fetchPublicQuoteProposal/respondToPublicQuoteProposal
// correctly map every one of the RPC's new response shapes (outcome:
// 'success' | 'already_responded' | 'invalid_token', plus a genuine
// network/HTTP failure) into a discriminated result the UI can act on,
// rather than collapsing them all back into a bare boolean/null the way
// the pre-119 functions did. The SQL side (the actual atomicity/
// concurrency guarantee) is covered by the transaction-safe SQL test
// script in PRODUCT_TOKEN_BACKUP_CONTENT_TEST_AUDIT.md -- not runnable
// from vitest, since it exercises a real Postgres function.

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

describe("fetchPublicQuoteProposal", () => {
  it("maps a real proposal to outcome 'found' with all fields, including the new respondedAt/approvalName", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      {
        outcome: "found",
        proposal_id: "p1",
        status: "sent",
        version: 2,
        content_snapshot: { siteName: "Test Site", clientName: "Test Client", city: "", quoteRef: "SQ-2026-0001", proposalSummary: "", bom: [], templateSections: [] },
        client_name: "Test Client",
        responded_at: null,
        approval_name: null,
      },
    ]);
    const result = await fetchPublicQuoteProposal("real-token");
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.data.status).toBe("sent");
      expect(result.data.respondedAt).toBeNull();
      expect(result.data.approvalName).toBeNull();
    }
  });

  it("maps an already-responded proposal's respondedAt/approvalName through correctly", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      {
        outcome: "found",
        proposal_id: "p1",
        status: "approved",
        version: 1,
        content_snapshot: { siteName: "Test Site", clientName: "Test Client", city: "", quoteRef: "SQ-2026-0001", proposalSummary: "", bom: [], templateSections: [] },
        client_name: "Test Client",
        responded_at: "2026-09-08T12:00:00Z",
        approval_name: "Jane Customer",
      },
    ]);
    const result = await fetchPublicQuoteProposal("real-token");
    expect(result.outcome).toBe("found");
    if (result.outcome === "found") {
      expect(result.data.status).toBe("approved");
      expect(result.data.respondedAt).toBe("2026-09-08T12:00:00Z");
      expect(result.data.approvalName).toBe("Jane Customer");
    }
  });

  it("maps a well-formed but empty response (bad/expired token) to outcome 'invalid_token', not a bare null", async () => {
    globalThis.fetch = mockFetchOnce(200, []);
    const result = await fetchPublicQuoteProposal("bad-token");
    expect(result.outcome).toBe("invalid_token");
  });

  // Migration 139 redefined get_quote_proposal_by_token to always return
  // exactly one row with a leading `outcome` column, never zero rows --
  // these three cases (a real token that resolves but isn't usable)
  // previously could not happen at all; each must map to its own
  // discriminated outcome, not be swallowed into "found" with null data
  // or a bare "error".
  it("maps outcome='invalid_token' with a real (non-empty) row to outcome 'invalid_token'", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "invalid_token", proposal_id: null, status: null, version: null, content_snapshot: null, client_name: null, responded_at: null, approval_name: null },
    ]);
    const result = await fetchPublicQuoteProposal("bad-token");
    expect(result.outcome).toBe("invalid_token");
  });

  it("maps outcome='expired' to outcome 'expired'", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "expired", proposal_id: null, status: null, version: null, content_snapshot: null, client_name: null, responded_at: null, approval_name: null },
    ]);
    const result = await fetchPublicQuoteProposal("expired-token");
    expect(result.outcome).toBe("expired");
  });

  it("maps outcome='superseded' to outcome 'superseded'", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "superseded", proposal_id: null, status: null, version: null, content_snapshot: null, client_name: null, responded_at: null, approval_name: null },
    ]);
    const result = await fetchPublicQuoteProposal("superseded-token");
    expect(result.outcome).toBe("superseded");
  });

  it("maps outcome='unavailable' (disabled or revoked, deliberately indistinguishable) to outcome 'unavailable'", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "unavailable", proposal_id: null, status: null, version: null, content_snapshot: null, client_name: null, responded_at: null, approval_name: null },
    ]);
    const result = await fetchPublicQuoteProposal("disabled-token");
    expect(result.outcome).toBe("unavailable");
  });

  it("maps an HTTP failure to outcome 'error', distinct from 'invalid_token'", async () => {
    globalThis.fetch = mockFetchOnce(503, {});
    const result = await fetchPublicQuoteProposal("any-token");
    expect(result.outcome).toBe("error");
  });

  it("maps a network-level throw to outcome 'error' without rejecting the caller's promise", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await fetchPublicQuoteProposal("any-token");
    expect(result.outcome).toBe("error");
  });
});

describe("respondToPublicQuoteProposal", () => {
  it("maps a first, winning response to outcome 'success' with the real recorded state", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "success", status: "approved", responded_at: "2026-09-08T12:00:00Z", approval_name: "Jane Customer", version: 1 },
    ]);
    const result = await respondToPublicQuoteProposal("token", "approved", "Jane Customer", "");
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
    const result = await respondToPublicQuoteProposal("token", "rejected", "Someone Else", "trying again");
    expect(result.outcome).toBe("already_responded");
    // The authoritative state is the ORIGINAL approval, not "rejected" /
    // "Someone Else" -- this is the whole point of the fix.
    expect(result.status).toBe("approved");
    expect(result.approvalName).toBe("Jane Customer");
  });

  it("maps an invalid-token response to outcome 'invalid_token' with null state", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "invalid_token", status: null, responded_at: null, approval_name: null, version: null },
    ]);
    const result = await respondToPublicQuoteProposal("bad-token", "approved", "Someone", "");
    expect(result.outcome).toBe("invalid_token");
    expect(result.status).toBeNull();
  });

  // Migration 139: a disabled/revoked/expired/superseded link must never
  // accept a response -- respond_to_quote_proposal() now reports which
  // before making any change, rather than the old behavior of just
  // rejecting the token as if it were unknown.
  it("maps a disabled/revoked link's response attempt to outcome 'unavailable'", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "unavailable", status: null, responded_at: null, approval_name: null, version: null },
    ]);
    const result = await respondToPublicQuoteProposal("disabled-token", "approved", "Someone", "");
    expect(result.outcome).toBe("unavailable");
  });

  it("maps an expired link's response attempt to outcome 'expired'", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "expired", status: null, responded_at: null, approval_name: null, version: null },
    ]);
    const result = await respondToPublicQuoteProposal("expired-token", "approved", "Someone", "");
    expect(result.outcome).toBe("expired");
  });

  it("maps a superseded link's response attempt to outcome 'superseded'", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "superseded", status: null, responded_at: null, approval_name: null, version: null },
    ]);
    const result = await respondToPublicQuoteProposal("superseded-token", "approved", "Someone", "");
    expect(result.outcome).toBe("superseded");
  });

  it("maps an HTTP failure to outcome 'error'", async () => {
    globalThis.fetch = mockFetchOnce(500, {});
    const result = await respondToPublicQuoteProposal("token", "approved", "Someone", "");
    expect(result.outcome).toBe("error");
  });

  it("maps a network-level throw to outcome 'error' without rejecting the caller's promise", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await respondToPublicQuoteProposal("token", "approved", "Someone", "");
    expect(result.outcome).toBe("error");
  });

  it("treats an unrecognized outcome string from a future/mismatched RPC version as 'error' rather than crashing", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      { outcome: "some_future_outcome_this_client_does_not_know_about", status: "approved", responded_at: null, approval_name: null, version: 1 },
    ]);
    const result = await respondToPublicQuoteProposal("token", "approved", "Someone", "");
    expect(result.outcome).toBe("error");
  });
});
