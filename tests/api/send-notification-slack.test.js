import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockReq, createMockRes, mockFetchRouter, jsonResponse } from "./_test-helpers.js";

const handler = (await import("../../api/send-notification-slack.js")).default;

const CALLER = { id: "caller-uuid", email: "caller@ergon.test" };

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  delete process.env.SLACK_BOT_TOKEN;
  process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/webhook";
  global.fetch = undefined;
  vi.clearAllMocks();
});

function routerFor({ notificationRows, deliveryRows = [], webhookOk = true }) {
  return mockFetchRouter([
    { match: "/auth/v1/user", respond: () => jsonResponse(200, CALLER) },
    { match: "/rest/v1/notification_deliveries", respond: () => jsonResponse(200, deliveryRows) },
    { match: "/rest/v1/notifications", respond: () => jsonResponse(200, notificationRows) },
    { match: "hooks.slack.test", respond: () => (webhookOk ? { ok: true, status: 200, text: async () => "ok" } : { ok: false, status: 500, text: async () => "boom" }) },
  ]);
}

describe("send-notification-slack", () => {
  it("signed-out caller: 401", async () => {
    global.fetch = vi.fn(mockFetchRouter([{ match: "/auth/v1/user", respond: () => jsonResponse(401, {}) }]));
    const res = createMockRes();
    await handler(createMockReq({ body: { notificationId: "n1" } }), res);
    expect(res.statusCode).toBe(401);
  });

  it("invalid notificationId: 404", async () => {
    global.fetch = vi.fn(routerFor({ notificationRows: [] }));
    const res = createMockRes();
    await handler(createMockReq({ body: { notificationId: "bogus" }, token: "t" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("posts the stored notification's own title/body to the webhook, ignoring a spoofed body in the request", async () => {
    const fetchMock = vi.fn(routerFor({
      notificationRows: [{ id: "n1", recipient_email: "real@ergon.test", title: "Real title", body: "Real body" }],
    }));
    global.fetch = fetchMock;
    const res = createMockRes();
    await handler(createMockReq({ body: { notificationId: "n1", title: "SPOOFED", body: "SPOOFED BODY" }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(true);
    const webhookCall = fetchMock.mock.calls.find(([url]) => String(url).includes("hooks.slack.test"));
    const posted = JSON.parse(webhookCall[1].body);
    expect(posted.text).toContain("Real title");
    expect(posted.text).toContain("Real body");
    expect(posted.text).not.toContain("SPOOFED");
  });

  it("does not re-deliver an already-sent notification", async () => {
    global.fetch = vi.fn(routerFor({
      notificationRows: [{ id: "n1", recipient_email: "real@ergon.test", title: "Real title", body: "" }],
      deliveryRows: [{ id: "d1" }],
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { notificationId: "n1" }, token: "t" }), res);
    expect(res.body.sent).toBe(false);
  });

  it("reports honestly when neither Slack mechanism is configured", async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    global.fetch = vi.fn(routerFor({
      notificationRows: [{ id: "n1", recipient_email: "real@ergon.test", title: "Real title", body: "" }],
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { notificationId: "n1" }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(false);
  });
});
