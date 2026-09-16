import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockReq, createMockRes, mockFetchRouter, jsonResponse, authUserResponse, systemHealthRpcHandlers } from "./_test-helpers.js";

vi.mock("../../api/_lib/mailer.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: true }),
}));

const handler = (await import("../../api/send-system-health-alert.js")).default;
const { sendEmail } = await import("../../api/_lib/mailer.js");

const CALLER = { id: "caller-uuid", email: "caller@ergon.test" };

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  vi.clearAllMocks();
});

function routerFor({ adminEmails = ["admin1@ergon.test", "admin2@ergon.test"] } = {}) {
  return mockFetchRouter([
    ...systemHealthRpcHandlers(),
    { match: "/auth/v1/user", respond: () => authUserResponse(CALLER) },
    { match: "/rest/v1/rpc/list_admin_emails", respond: () => jsonResponse(200, adminEmails) },
  ]);
}

describe("send-system-health-alert", () => {
  it("signed-out caller: 401, never sends", async () => {
    global.fetch = vi.fn(mockFetchRouter([{ match: "/auth/v1/user", respond: () => jsonResponse(401, {}) }]));
    const res = createMockRes();
    await handler(createMockReq({ body: { kind: "alert", surface: "cron", failureReasonCode: "x" }, token: "t" }), res);
    expect(res.statusCode).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("invalid kind: 400", async () => {
    global.fetch = vi.fn(routerFor());
    const res = createMockRes();
    await handler(createMockReq({ body: { kind: "not-a-real-kind", surface: "cron", failureReasonCode: "x" }, token: "t" }), res);
    expect(res.statusCode).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("missing surface/failureReasonCode: 400", async () => {
    global.fetch = vi.fn(routerFor());
    const res = createMockRes();
    await handler(createMockReq({ body: { kind: "alert" }, token: "t" }), res);
    expect(res.statusCode).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("alert: emails every real admin (re-derived server-side, ignoring any client-supplied recipient list)", async () => {
    global.fetch = vi.fn(routerFor({ adminEmails: ["admin1@ergon.test", "admin2@ergon.test"] }));
    const res = createMockRes();
    await handler(
      createMockReq({
        body: { kind: "alert", surface: "cron", entityType: "cron_job", failureReasonCode: "task_overdue_load_failed", severity: "down", occurrenceCount: 3, adminEmails: ["attacker@evil.test"] },
        token: "t",
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.sentCount).toBe(2);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const recipients = sendEmail.mock.calls.map((call) => call[0].to);
    expect(recipients).toEqual(["admin1@ergon.test", "admin2@ergon.test"]);
    expect(recipients).not.toContain("attacker@evil.test");
    expect(sendEmail.mock.calls[0][0].subject).toContain("DOWN");
    expect(sendEmail.mock.calls[0][0].subject).toContain("task_overdue_load_failed");
  });

  it("recovery: subject/body read 'recovered', not 'DOWN'", async () => {
    global.fetch = vi.fn(routerFor());
    const res = createMockRes();
    await handler(createMockReq({ body: { kind: "recovery", surface: "cron", failureReasonCode: "task_overdue_load_failed" }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(sendEmail.mock.calls[0][0].subject).toContain("recovered");
  });

  it("no admins found: sent:false, never calls sendEmail", async () => {
    global.fetch = vi.fn(routerFor({ adminEmails: [] }));
    const res = createMockRes();
    await handler(createMockReq({ body: { kind: "alert", surface: "cron", failureReasonCode: "x" }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("is rate-limited per caller after 10 requests in the window", async () => {
    // A fresh, unique caller id -- the in-memory rate-limit bucket is a
    // module-level singleton keyed by caller id, so reusing CALLER's id
    // here would inherit hits from this file's earlier tests.
    const rateLimitCaller = { id: `rate-limit-test-${Date.now()}`, email: "rate-limit-test@ergon.test" };
    global.fetch = vi.fn(
      mockFetchRouter([
        ...systemHealthRpcHandlers(),
        { match: "/auth/v1/user", respond: () => authUserResponse(rateLimitCaller) },
        { match: "/rest/v1/rpc/list_admin_emails", respond: () => jsonResponse(200, ["admin1@ergon.test"]) },
      ]),
    );
    for (let i = 0; i < 10; i += 1) {
      const res = createMockRes();
      await handler(createMockReq({ body: { kind: "alert", surface: "cron", failureReasonCode: "x" }, token: "t" }), res);
      expect(res.statusCode).toBe(200);
    }
    const res = createMockRes();
    await handler(createMockReq({ body: { kind: "alert", surface: "cron", failureReasonCode: "x" }, token: "t" }), res);
    expect(res.statusCode).toBe(429);
  });
});
