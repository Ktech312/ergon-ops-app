import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockReq, createMockRes, mockFetchRouter, jsonResponse } from "./_test-helpers.js";

vi.mock("../../api/_lib/mailer.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: true }),
}));

const handler = (await import("../../api/send-notification-email.js")).default;
const { sendEmail } = await import("../../api/_lib/mailer.js");

const CALLER = { id: "caller-uuid", email: "caller@ergon.test" };

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  vi.clearAllMocks();
});

function routerFor({ notificationRows, deliveryRows = [], knownUserRows }) {
  return mockFetchRouter([
    { match: "/auth/v1/user", respond: () => jsonResponse(200, CALLER) },
    { match: "/rest/v1/notification_deliveries", respond: () => jsonResponse(200, deliveryRows) },
    { match: "/rest/v1/notifications", respond: () => jsonResponse(200, notificationRows) },
    { match: "/rest/v1/app_known_users", respond: () => jsonResponse(200, knownUserRows) },
  ]);
}

describe("send-notification-email", () => {
  it("signed-out caller: 401", async () => {
    global.fetch = vi.fn(mockFetchRouter([{ match: "/auth/v1/user", respond: () => jsonResponse(401, {}) }]));
    const res = createMockRes();
    await handler(createMockReq({ body: { notificationId: "n1" } }), res);
    expect(res.statusCode).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("missing notificationId: 400", async () => {
    global.fetch = vi.fn(mockFetchRouter([{ match: "/auth/v1/user", respond: () => jsonResponse(200, CALLER) }]));
    const res = createMockRes();
    await handler(createMockReq({ body: {}, token: "t" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("invalid notificationId: 404, never calls sendEmail", async () => {
    global.fetch = vi.fn(routerFor({ notificationRows: [], knownUserRows: [] }));
    const res = createMockRes();
    await handler(createMockReq({ body: { notificationId: "does-not-exist" }, token: "t" }), res);
    expect(res.statusCode).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("recipient not a known Ergon user: 403, never calls sendEmail (closes the open-relay-to-arbitrary-address gap)", async () => {
    global.fetch = vi.fn(routerFor({
      notificationRows: [{ id: "n1", recipient_email: "outsider@external.test", title: "Hi", body: "" }],
      knownUserRows: [],
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { notificationId: "n1" }, token: "t" }), res);
    expect(res.statusCode).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("authorized: delivers using the stored notification's own recipient/subject/body, ignoring a spoofed body in the request", async () => {
    global.fetch = vi.fn(routerFor({
      notificationRows: [{ id: "n1", recipient_email: "real@ergon.test", title: "Real subject", body: "Real body" }],
      knownUserRows: [{ user_id: "real-uuid" }],
    }));
    const res = createMockRes();
    await handler(
      createMockReq({ body: { notificationId: "n1", to: "someone-else@ergon.test", subject: "SPOOFED", body: "SPOOFED BODY" }, token: "t" }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = sendEmail.mock.calls[0][0];
    expect(call.to).toBe("real@ergon.test");
    expect(call.subject).toBe("Real subject");
    expect(call.html).toContain("Real body");
  });

  it("does not re-deliver an already-sent notification", async () => {
    global.fetch = vi.fn(routerFor({
      notificationRows: [{ id: "n1", recipient_email: "real@ergon.test", title: "Real subject", body: "" }],
      deliveryRows: [{ id: "d1" }],
      knownUserRows: [{ user_id: "real-uuid" }],
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { notificationId: "n1" }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects a notification whose stored content is too long to email (defense in depth -- notifications has no length CHECK constraint)", async () => {
    global.fetch = vi.fn(routerFor({
      notificationRows: [{ id: "n1", recipient_email: "real@ergon.test", title: "x".repeat(400), body: "" }],
      knownUserRows: [{ user_id: "real-uuid" }],
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { notificationId: "n1" }, token: "t" }), res);
    expect(res.statusCode).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
