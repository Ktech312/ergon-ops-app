import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockReq, createMockRes, mockFetchRouter, jsonResponse } from "./_test-helpers.js";

vi.mock("./_lib/mailer.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: true }),
}));

const handler = (await import("./send-submittal-email.js")).default;
const { sendEmail } = await import("./_lib/mailer.js");

const CALLER = { id: "caller-uuid", email: "caller@ergon.test" };
const ALLOWED_SHARE_URL = "https://ergon-ops-app.vercel.app/?submittal=abc123";

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
  vi.clearAllMocks();
});

function routerFor({ isAdmin = false, roleKeys = [], submittalRows }) {
  return mockFetchRouter([
    { match: "/auth/v1/user", respond: () => jsonResponse(200, CALLER) },
    { match: "/rest/v1/app_admins", respond: () => jsonResponse(200, isAdmin ? [{ user_id: CALLER.id }] : []) },
    { match: "/rest/v1/app_user_roles", respond: () => jsonResponse(200, roleKeys.map((role_key) => ({ role_key }))) },
    { match: "/rest/v1/project_submittals", respond: () => jsonResponse(200, submittalRows) },
  ]);
}

describe("send-submittal-email", () => {
  it("signed-out caller: 401", async () => {
    global.fetch = vi.fn(mockFetchRouter([{ match: "/auth/v1/user", respond: () => jsonResponse(401, {}) }]));
    const res = createMockRes();
    await handler(createMockReq({ body: { submittalId: "s1", shareUrl: ALLOWED_SHARE_URL } }), res);
    expect(res.statusCode).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("signed-in but not pm/admin (e.g. manager): 403 -- matches project_submittals' own write RLS, no regression", async () => {
    global.fetch = vi.fn(routerFor({ roleKeys: ["manager"], submittalRows: [] }));
    const res = createMockRes();
    await handler(createMockReq({ body: { submittalId: "s1", shareUrl: ALLOWED_SHARE_URL }, token: "t" }), res);
    expect(res.statusCode).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects a destination URL that doesn't point back at this app", async () => {
    global.fetch = vi.fn(routerFor({ roleKeys: ["pm"], submittalRows: [] }));
    const res = createMockRes();
    await handler(createMockReq({ body: { submittalId: "s1", shareUrl: "https://evil.example/phish" }, token: "t" }), res);
    expect(res.statusCode).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("invalid/nonexistent submittalId: 404", async () => {
    global.fetch = vi.fn(routerFor({ roleKeys: ["pm"], submittalRows: [] }));
    const res = createMockRes();
    await handler(createMockReq({ body: { submittalId: "does-not-exist", shareUrl: ALLOWED_SHARE_URL }, token: "t" }), res);
    expect(res.statusCode).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("authorized pm caller: sends using the stored submittal's own client/project data, ignoring a spoofed payload", async () => {
    global.fetch = vi.fn(routerFor({
      roleKeys: ["pm"],
      submittalRows: [{ client_name: "Real Client", client_email: "real-client@external.test", content_snapshot: { projectName: "Real Project", projectRef: "PRJ-0001" } }],
    }));
    const res = createMockRes();
    await handler(
      createMockReq({
        body: { submittalId: "s1", shareUrl: ALLOWED_SHARE_URL, clientEmail: "attacker@external.test", projectName: "SPOOFED", projectRef: "FAKE-REF" },
        token: "t",
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = sendEmail.mock.calls[0][0];
    expect(call.to).toBe("real-client@external.test");
    expect(call.html).toContain("Real Project");
    expect(call.html).toContain("PRJ-0001");
    expect(call.html).not.toContain("SPOOFED");
    expect(call.html).not.toContain("FAKE-REF");
  });

  it("admin bypasses the role list entirely", async () => {
    global.fetch = vi.fn(routerFor({
      isAdmin: true,
      roleKeys: [],
      submittalRows: [{ client_name: "Real Client", client_email: "real-client@external.test", content_snapshot: {} }],
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { submittalId: "s1", shareUrl: ALLOWED_SHARE_URL }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
