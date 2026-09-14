import { describe, it, expect, beforeEach, vi } from "vitest";
import { createAndSendSubmittalVersion, createAndSendQuoteProposalVersion } from "./persistence";

// Queue C2.7: createAndSendSubmittalVersion/createAndSendQuoteProposalVersion
// replace the old two-step create-row-then-create-token direct-write flow
// with migration 140's single atomic RPC. The RPC itself only returns
// {submittal_id/proposal_id, token} (proven by migration 140's own SQL
// test); these wrappers re-fetch the full row + token status right after,
// so callers get back the same complete object shape the old functions
// returned directly. These tests lock in that mapping and request shape.

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

describe("createAndSendSubmittalVersion", () => {
  it("posts to rpc/create_and_send_submittal_version with the real parameter names, then re-fetches the full row and token", async () => {
    globalThis.fetch = mockFetchSequence([
      { status: 200, body: [{ submittal_id: "s1", token: "tok123" }] },
      {
        status: 200,
        body: [
          {
            id: "s1",
            project_id: "p1",
            version: 3,
            status: "sent",
            content_snapshot: { projectName: "Test Project", projectRef: "PRJ-1", clientName: "Test Client", siteAddress: "", targetDate: "", allocated: 0, sow: { summary: "", preparation: "", infrastructure: "", installation: "", commissioning: "", fineTuning: "", assumptions: "", exclusions: "" }, bom: [] },
            client_name: "Test Client",
            client_email: "client@example.com",
            sent_at: "2026-09-14T00:00:00Z",
            responded_at: null,
            response_notes: null,
            approval_name: null,
            created_at: "2026-09-14T00:00:00Z",
          },
        ],
      },
      { status: 200, body: [{ token: "tok123", entity_id: "s1", status: "active", created_at: "2026-09-14T00:00:00Z" }] },
    ]);

    const result = await createAndSendSubmittalVersion(
      { projectId: "p1", contentSnapshot: { projectName: "Test Project", projectRef: "PRJ-1", clientName: "Test Client", siteAddress: "", targetDate: "", allocated: 0, sow: { summary: "", preparation: "", infrastructure: "", installation: "", commissioning: "", fineTuning: "", assumptions: "", exclusions: "" }, bom: [] }, clientName: "Test Client", clientEmail: "client@example.com" },
      "access-token",
    );

    const rpcCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcCall[0]).toContain("rpc/create_and_send_submittal_version");
    expect(JSON.parse(rpcCall[1].body)).toEqual({
      p_project_id: "p1",
      p_content_snapshot: { projectName: "Test Project", projectRef: "PRJ-1", clientName: "Test Client", siteAddress: "", targetDate: "", allocated: 0, sow: { summary: "", preparation: "", infrastructure: "", installation: "", commissioning: "", fineTuning: "", assumptions: "", exclusions: "" }, bom: [] },
      p_client_name: "Test Client",
      p_client_email: "client@example.com",
    });

    expect(result.id).toBe("s1");
    expect(result.version).toBe(3);
    expect(result.shareToken).toBe("tok123");
    expect(result.shareTokenStatus).toBe("active");
  });

  it("throws when the RPC call itself fails, without attempting the follow-up fetches", async () => {
    globalThis.fetch = mockFetchSequence([{ status: 403, body: { message: "Only a PM or admin may create and send a submittal version." } }]);
    await expect(
      createAndSendSubmittalVersion({ projectId: "p1", contentSnapshot: {} as never, clientName: "", clientEmail: "" }, "access-token"),
    ).rejects.toThrow();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe("createAndSendQuoteProposalVersion", () => {
  it("posts to rpc/create_and_send_quote_proposal_version with the real parameter names, then re-fetches the full row and token", async () => {
    globalThis.fetch = mockFetchSequence([
      { status: 200, body: [{ proposal_id: "prop1", token: "tok456" }] },
      {
        status: 200,
        body: [
          {
            id: "prop1",
            quote_id: "q1",
            version: 2,
            status: "sent",
            content_snapshot: { siteName: "Test Site", clientName: "Test Client", city: "", quoteRef: "SQ-1", proposalSummary: "", bom: [], templateSections: [] },
            client_name: "Test Client",
            client_email: "client@example.com",
            sent_at: "2026-09-14T00:00:00Z",
            responded_at: null,
            response_notes: null,
            approval_name: null,
            created_at: "2026-09-14T00:00:00Z",
          },
        ],
      },
      { status: 200, body: [{ token: "tok456", entity_id: "prop1", status: "active", created_at: "2026-09-14T00:00:00Z" }] },
    ]);

    const result = await createAndSendQuoteProposalVersion(
      { quoteId: "q1", contentSnapshot: { siteName: "Test Site", clientName: "Test Client", city: "", quoteRef: "SQ-1", proposalSummary: "", bom: [], templateSections: [] }, clientName: "Test Client", clientEmail: "client@example.com" },
      "access-token",
    );

    const rpcCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcCall[0]).toContain("rpc/create_and_send_quote_proposal_version");
    expect(JSON.parse(rpcCall[1].body)).toEqual({
      p_quote_id: "q1",
      p_content_snapshot: { siteName: "Test Site", clientName: "Test Client", city: "", quoteRef: "SQ-1", proposalSummary: "", bom: [], templateSections: [] },
      p_client_name: "Test Client",
      p_client_email: "client@example.com",
    });

    expect(result.id).toBe("prop1");
    expect(result.version).toBe(2);
    expect(result.shareToken).toBe("tok456");
    expect(result.shareTokenStatus).toBe("active");
  });

  it("throws when the RPC call itself fails, without attempting the follow-up fetches", async () => {
    globalThis.fetch = mockFetchSequence([{ status: 403, body: { message: "Only Sales, a manager, or an admin may create and send a proposal version." } }]);
    await expect(
      createAndSendQuoteProposalVersion({ quoteId: "q1", contentSnapshot: {} as never, clientName: "", clientEmail: "" }, "access-token"),
    ).rejects.toThrow();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});
