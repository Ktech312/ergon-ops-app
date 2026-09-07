import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockReq, createMockRes, mockFetchRouter, jsonResponse } from "./_test-helpers.js";

vi.mock("../../api/_lib/mailer.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: true }),
}));

const handler = (await import("../../api/send-invite-email.js")).default;
const { sendEmail } = await import("../../api/_lib/mailer.js");

const CALLER = { id: "caller-uuid", email: "caller@ergon.test" };
const ALLOWED_INVITE_URL = "https://ergon-ops-app.vercel.app/?invite=abc123";

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
  vi.clearAllMocks();
});

function routerFor({ isAdmin = false, roleKeys = [] }) {
  return mockFetchRouter([
    { match: "/auth/v1/user", respond: () => jsonResponse(200, CALLER) },
    { match: "/rest/v1/app_admins", respond: () => jsonResponse(200, isAdmin ? [{ user_id: CALLER.id }] : []) },
    { match: "/rest/v1/app_user_roles", respond: () => jsonResponse(200, roleKeys.map((role_key) => ({ role_key }))) },
  ]);
}

describe("send-invite-email", () => {
  it("signed-out caller: 401", async () => {
    global.fetch = vi.fn(mockFetchRouter([{ match: "/auth/v1/user", respond: () => jsonResponse(401, {}) }]));
    const res = createMockRes();
    await handler(createMockReq({ body: { email: "new@ergon.test", inviteUrl: ALLOWED_INVITE_URL } }), res);
    expect(res.statusCode).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("signed-in but not admin: 403 -- inviting is admin-only, no role grants it", async () => {
    global.fetch = vi.fn(routerFor({ roleKeys: ["manager", "sales", "pm"] }));
    const res = createMockRes();
    await handler(createMockReq({ body: { email: "new@ergon.test", inviteUrl: ALLOWED_INVITE_URL }, token: "t" }), res);
    expect(res.statusCode).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects an inviteUrl that doesn't point back at this app (phishing-link guard)", async () => {
    global.fetch = vi.fn(routerFor({ isAdmin: true }));
    const res = createMockRes();
    await handler(createMockReq({ body: { email: "new@ergon.test", inviteUrl: "https://evil.example/steal-creds" }, token: "t" }), res);
    expect(res.statusCode).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects a malformed email address", async () => {
    global.fetch = vi.fn(routerFor({ isAdmin: true }));
    const res = createMockRes();
    await handler(createMockReq({ body: { email: "not-an-email", inviteUrl: ALLOWED_INVITE_URL }, token: "t" }), res);
    expect(res.statusCode).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("authorized admin: sends the invite", async () => {
    global.fetch = vi.fn(routerFor({ isAdmin: true }));
    const res = createMockRes();
    await handler(createMockReq({ body: { email: "new@ergon.test", inviteUrl: ALLOWED_INVITE_URL, fullName: "New Hire", roleLabel: "sales" }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe("new@ergon.test");
  });
});
