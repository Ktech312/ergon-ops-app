import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  disableShareLink,
  reEnableShareLink,
  permanentlyRevokeShareLink,
  createNewSubmittalShareToken,
  createNewQuoteProposalShareToken,
  loadShareLinkActivity,
  loadSubmittalsForProject,
  loadProposalsForQuote,
} from "./persistence";

// Queue C2.6: the internal share-link lifecycle controls (Disable/
// Re-enable, Permanently Revoke & Generate New Link, activity/history) --
// migrations 138/139 already proved the RPCs themselves via SQL tests;
// these lock in the frontend half, that each wrapper sends the RPC its
// real parameter names and maps a real response correctly.

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function mockFetchSequence(entries: Array<{ status: number; body: unknown }>) {
  const fn = vi.fn();
  for (const entry of entries) {
    fn.mockResolvedValueOnce({
      ok: entry.status >= 200 && entry.status < 300,
      status: entry.status,
      json: async () => entry.body,
    });
  }
  return fn;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("disableShareLink", () => {
  it("posts to rpc/disable_share_link with the token and reason, and returns the RPC's result string", async () => {
    globalThis.fetch = mockFetchOnce(200, "success");
    const result = await disableShareLink("tok123", "client asked", "access-token");
    expect(result).toEqual({ ok: true, result: "success" });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("rpc/disable_share_link");
    expect(JSON.parse(call[1].body)).toEqual({ p_token: "tok123", p_reason: "client asked" });
  });

  it("sends a null reason when none is given", async () => {
    globalThis.fetch = mockFetchOnce(200, "already_not_active");
    await disableShareLink("tok123", "", "access-token");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(call[1].body).p_reason).toBeNull();
  });

  it("maps an HTTP failure to ok:false with an error message, not a thrown exception", async () => {
    globalThis.fetch = mockFetchOnce(403, { message: "Only a PM or admin may manage a submittal share link." });
    const result = await disableShareLink("tok123", "", "access-token");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("reEnableShareLink", () => {
  it("posts to rpc/re_enable_share_link with just the token", async () => {
    globalThis.fetch = mockFetchOnce(200, "success");
    const result = await reEnableShareLink("tok123", "access-token");
    expect(result).toEqual({ ok: true, result: "success" });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("rpc/re_enable_share_link");
    expect(JSON.parse(call[1].body)).toEqual({ p_token: "tok123" });
  });
});

describe("permanentlyRevokeShareLink", () => {
  it("posts to rpc/permanently_revoke_share_link with the token and reason", async () => {
    globalThis.fetch = mockFetchOnce(200, "success");
    const result = await permanentlyRevokeShareLink("tok123", "superseded manually", "access-token");
    expect(result).toEqual({ ok: true, result: "success" });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("rpc/permanently_revoke_share_link");
    expect(JSON.parse(call[1].body)).toEqual({ p_token: "tok123", p_reason: "superseded manually" });
  });

  it("reports already_terminal without treating it as an error", async () => {
    globalThis.fetch = mockFetchOnce(200, "already_terminal");
    const result = await permanentlyRevokeShareLink("tok123", "", "access-token");
    expect(result.ok).toBe(true);
    expect(result.result).toBe("already_terminal");
  });
});

describe("createNewSubmittalShareToken / createNewQuoteProposalShareToken", () => {
  it("posts to rpc/create_submittal_share_token with p_submittal_id and returns the new token", async () => {
    globalThis.fetch = mockFetchOnce(200, "abc123def456");
    const token = await createNewSubmittalShareToken("submittal-1", "access-token");
    expect(token).toBe("abc123def456");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("rpc/create_submittal_share_token");
    expect(JSON.parse(call[1].body)).toEqual({ p_submittal_id: "submittal-1" });
  });

  it("posts to rpc/create_quote_proposal_share_token with p_proposal_id and returns the new token", async () => {
    globalThis.fetch = mockFetchOnce(200, "xyz789");
    const token = await createNewQuoteProposalShareToken("proposal-1", "access-token");
    expect(token).toBe("xyz789");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("rpc/create_quote_proposal_share_token");
    expect(JSON.parse(call[1].body)).toEqual({ p_proposal_id: "proposal-1" });
  });

  it("throws (does not silently return an empty token) on an HTTP failure", async () => {
    globalThis.fetch = mockFetchOnce(403, { message: "Only a PM or admin may create a share link for a submittal." });
    await expect(createNewSubmittalShareToken("submittal-1", "access-token")).rejects.toThrow();
  });
});

describe("loadShareLinkActivity", () => {
  it("summarizes real view rows into a count plus first/last timestamps, and maps action rows", async () => {
    globalThis.fetch = mockFetchSequence([
      {
        status: 200,
        body: [
          { id: "a1", token: "tok1", action: "created", actor_email: "sales@example.com", reason: null, occurred_at: "2026-09-01T00:00:00Z" },
          { id: "a2", token: "tok1", action: "temporarily_disabled", actor_email: "sales@example.com", reason: "client requested pause", occurred_at: "2026-09-02T00:00:00Z" },
        ],
      },
      {
        status: 200,
        body: [{ viewed_at: "2026-09-01T10:00:00Z" }, { viewed_at: "2026-09-01T11:00:00Z" }, { viewed_at: "2026-09-03T09:00:00Z" }],
      },
    ]);
    const activity = await loadShareLinkActivity("sales_quote_proposal", "proposal-1", "access-token");
    expect(activity.viewCount).toBe(3);
    expect(activity.firstViewedAt).toBe("2026-09-01T10:00:00Z");
    expect(activity.lastViewedAt).toBe("2026-09-03T09:00:00Z");
    expect(activity.actions).toHaveLength(2);
    expect(activity.actions[1]).toEqual({
      id: "a2",
      token: "tok1",
      action: "temporarily_disabled",
      actorEmail: "sales@example.com",
      reason: "client requested pause",
      occurredAt: "2026-09-02T00:00:00Z",
    });
  });

  it("reports zero views and no timestamps for a never-viewed link, not an error", async () => {
    globalThis.fetch = mockFetchSequence([
      { status: 200, body: [{ id: "a1", token: "tok1", action: "created", actor_email: "pm@example.com", reason: null, occurred_at: "2026-09-01T00:00:00Z" }] },
      { status: 200, body: [] },
    ]);
    const activity = await loadShareLinkActivity("project_submittal", "submittal-1", "access-token");
    expect(activity.viewCount).toBe(0);
    expect(activity.firstViewedAt).toBeNull();
    expect(activity.lastViewedAt).toBeNull();
    expect(activity.actions).toHaveLength(1);
  });

  it("degrades to an empty actions list if only the actions request fails, without throwing", async () => {
    globalThis.fetch = mockFetchSequence([
      { status: 500, body: {} },
      { status: 200, body: [{ viewed_at: "2026-09-01T10:00:00Z" }] },
    ]);
    const activity = await loadShareLinkActivity("project_submittal", "submittal-1", "access-token");
    expect(activity.actions).toEqual([]);
    expect(activity.viewCount).toBe(1);
  });
});

describe("loadSubmittalsForProject / loadProposalsForQuote -- shareTokenStatus threading", () => {
  it("threads the token's lifecycle status onto each mapped submittal", async () => {
    globalThis.fetch = mockFetchSequence([
      {
        status: 200,
        body: [
          {
            id: "s1",
            project_id: "p1",
            version: 1,
            status: "sent",
            content_snapshot: {},
            client_name: "Client",
            client_email: "client@example.com",
            sent_at: "2026-09-01T00:00:00Z",
            responded_at: null,
            response_notes: null,
            approval_name: null,
            created_at: "2026-09-01T00:00:00Z",
          },
        ],
      },
      { status: 200, body: [{ token: "tok1", entity_id: "s1", status: "temporarily_disabled", created_at: "2026-09-02T00:00:00Z" }] },
    ]);
    const [submittal] = await loadSubmittalsForProject("p1", "access-token");
    expect(submittal.shareToken).toBe("tok1");
    expect(submittal.shareTokenStatus).toBe("temporarily_disabled");
  });

  it("picks the most recent token when a submittal has more than one (post-regenerate)", async () => {
    globalThis.fetch = mockFetchSequence([
      {
        status: 200,
        body: [
          {
            id: "s1",
            project_id: "p1",
            version: 1,
            status: "sent",
            content_snapshot: {},
            client_name: null,
            client_email: null,
            sent_at: null,
            responded_at: null,
            response_notes: null,
            approval_name: null,
            created_at: "2026-09-01T00:00:00Z",
          },
        ],
      },
      {
        status: 200,
        body: [
          { token: "new-tok", entity_id: "s1", status: "active", created_at: "2026-09-05T00:00:00Z" },
          { token: "old-tok", entity_id: "s1", status: "permanently_revoked", created_at: "2026-09-01T00:00:00Z" },
        ],
      },
    ]);
    const [submittal] = await loadSubmittalsForProject("p1", "access-token");
    expect(submittal.shareToken).toBe("new-tok");
    expect(submittal.shareTokenStatus).toBe("active");
  });

  it("threads the token's lifecycle status onto each mapped proposal", async () => {
    globalThis.fetch = mockFetchSequence([
      {
        status: 200,
        body: [
          {
            id: "prop1",
            quote_id: "q1",
            version: 1,
            status: "sent",
            content_snapshot: {},
            client_name: null,
            client_email: null,
            sent_at: null,
            responded_at: null,
            response_notes: null,
            approval_name: null,
            created_at: "2026-09-01T00:00:00Z",
          },
        ],
      },
      { status: 200, body: [{ token: "tok2", entity_id: "prop1", status: "superseded", created_at: "2026-09-02T00:00:00Z" }] },
    ]);
    const [proposal] = await loadProposalsForQuote("q1", "access-token");
    expect(proposal.shareToken).toBe("tok2");
    expect(proposal.shareTokenStatus).toBe("superseded");
  });
});
