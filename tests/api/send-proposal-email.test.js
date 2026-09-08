import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockReq, createMockRes, mockFetchRouter, jsonResponse } from "./_test-helpers.js";

vi.mock("../../api/_lib/mailer.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: true }),
}));

const handler = (await import("../../api/send-proposal-email.js")).default;
const { sendEmail } = await import("../../api/_lib/mailer.js");

const CALLER = { id: "caller-uuid", email: "caller@ergon.test" };
const ALLOWED_SHARE_URL = "https://ergon-ops-app.vercel.app/?proposal=abc123";

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
  vi.clearAllMocks();
});

function routerFor({ isAdmin = false, roleKeys = [], proposalRows }) {
  return mockFetchRouter([
    { match: "/auth/v1/user", respond: () => jsonResponse(200, CALLER) },
    { match: "/rest/v1/app_admins", respond: () => jsonResponse(200, isAdmin ? [{ user_id: CALLER.id }] : []) },
    { match: "/rest/v1/app_user_roles", respond: () => jsonResponse(200, roleKeys.map((role_key) => ({ role_key }))) },
    { match: "/rest/v1/sales_quote_proposals", respond: () => jsonResponse(200, proposalRows) },
  ]);
}

describe("send-proposal-email", () => {
  it("signed-out caller: 401", async () => {
    global.fetch = vi.fn(mockFetchRouter([{ match: "/auth/v1/user", respond: () => jsonResponse(401, {}) }]));
    const res = createMockRes();
    await handler(createMockReq({ body: { proposalId: "p1", shareUrl: ALLOWED_SHARE_URL } }), res);
    expect(res.statusCode).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("signed-in but unauthorized role (e.g. warehouse): 403", async () => {
    global.fetch = vi.fn(routerFor({ roleKeys: ["warehouse"], proposalRows: [] }));
    const res = createMockRes();
    await handler(createMockReq({ body: { proposalId: "p1", shareUrl: ALLOWED_SHARE_URL }, token: "t" }), res);
    expect(res.statusCode).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects a destination URL that doesn't point back at this app", async () => {
    global.fetch = vi.fn(routerFor({ roleKeys: ["sales"], proposalRows: [] }));
    const res = createMockRes();
    await handler(createMockReq({ body: { proposalId: "p1", shareUrl: "https://evil.example/phish" }, token: "t" }), res);
    expect(res.statusCode).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("invalid/nonexistent proposalId: 404", async () => {
    global.fetch = vi.fn(routerFor({ roleKeys: ["sales"], proposalRows: [] }));
    const res = createMockRes();
    await handler(createMockReq({ body: { proposalId: "does-not-exist", shareUrl: ALLOWED_SHARE_URL }, token: "t" }), res);
    expect(res.statusCode).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("authorized sales caller: sends using the stored proposal's own client/site data, ignoring a spoofed payload", async () => {
    global.fetch = vi.fn(routerFor({
      roleKeys: ["sales"],
      proposalRows: [{ quote_id: "11112222-3333-4444-5555-666677778888", client_name: "Real Client", client_email: "real-client@external.test", content_snapshot: { siteName: "Real Site" } }],
    }));
    const res = createMockRes();
    await handler(
      createMockReq({
        body: { proposalId: "p1", shareUrl: ALLOWED_SHARE_URL, clientEmail: "attacker@external.test", clientName: "SPOOFED", siteName: "SPOOFED SITE" },
        token: "t",
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = sendEmail.mock.calls[0][0];
    expect(call.to).toBe("real-client@external.test");
    expect(call.html).toContain("Real Client");
    expect(call.html).toContain("Real Site");
    expect(call.html).not.toContain("SPOOFED");
  });

  it("uses the real quote_ref from the proposal's own content_snapshot, not a fabricated one derived from quote_id", async () => {
    global.fetch = vi.fn(routerFor({
      roleKeys: ["sales"],
      proposalRows: [{
        quote_id: "11112222-3333-4444-5555-666677778888",
        client_name: "Real Client",
        client_email: "real-client@external.test",
        content_snapshot: { siteName: "Real Site", quoteRef: "SQ-2026-0042" },
      }],
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { proposalId: "p1", shareUrl: ALLOWED_SHARE_URL }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    const call = sendEmail.mock.calls[0][0];
    expect(call.subject).toContain("SQ-2026-0042");
    expect(call.html).toContain("SQ-2026-0042");
    // The old, fixed 2026-09-08 bug fabricated a ref from quote_id.slice(0, 8).toUpperCase() --
    // for this quote_id that would render as "11112222", which must never appear.
    expect(call.subject).not.toContain("11112222");
    expect(call.html).not.toContain("11112222");
  });

  it("omits the ref entirely (no parenthetical) when an older proposal's content_snapshot has no quoteRef", async () => {
    global.fetch = vi.fn(routerFor({
      roleKeys: ["sales"],
      proposalRows: [{
        quote_id: "11112222-3333-4444-5555-666677778888",
        client_name: "Real Client",
        client_email: "real-client@external.test",
        content_snapshot: { siteName: "Real Site" },
      }],
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { proposalId: "p1", shareUrl: ALLOWED_SHARE_URL }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    const call = sendEmail.mock.calls[0][0];
    expect(call.subject).toBe("Proposal for Real Site");
    expect(call.html).not.toContain("11112222");
  });

  it("manager role is also authorized", async () => {
    global.fetch = vi.fn(routerFor({
      roleKeys: ["manager"],
      proposalRows: [{ quote_id: "11112222-3333-4444-5555-666677778888", client_name: "Real Client", client_email: "real-client@external.test", content_snapshot: {} }],
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { proposalId: "p1", shareUrl: ALLOWED_SHARE_URL }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("admin bypasses the role list entirely", async () => {
    global.fetch = vi.fn(routerFor({
      isAdmin: true,
      roleKeys: [],
      proposalRows: [{ quote_id: "11112222-3333-4444-5555-666677778888", client_name: "Real Client", client_email: "real-client@external.test", content_snapshot: {} }],
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { proposalId: "p1", shareUrl: ALLOWED_SHARE_URL }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
