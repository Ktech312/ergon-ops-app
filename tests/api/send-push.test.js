import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockReq, createMockRes, mockFetchRouter, jsonResponse } from "./_test-helpers.js";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue(undefined),
  },
}));

const handler = (await import("../../api/send-push.js")).default;
const webpush = (await import("web-push")).default;

const SUPABASE_URL = "https://test.supabase.co";
const ANON_KEY = "anon-key";
const SERVICE_KEY = "service-role-key";

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = SUPABASE_URL;
  process.env.VITE_SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.VAPID_PUBLIC_KEY = "public-key";
  process.env.VAPID_PRIVATE_KEY = "private-key";
  vi.clearAllMocks();
});

const SENDER = { id: "sender-uuid", email: "sender@ergon.test" };

describe("send-push: signed-out caller", () => {
  it("rejects with 401 before touching anything else", async () => {
    global.fetch = vi.fn(mockFetchRouter([
      { match: "/auth/v1/user", respond: () => jsonResponse(401, { error: "invalid token" }) },
    ]));
    const req = createMockReq({ body: { notificationId: "n1" } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });
});

describe("send-push: missing target", () => {
  it("400s when neither directMessageId nor notificationId is present", async () => {
    global.fetch = vi.fn(mockFetchRouter([
      { match: "/auth/v1/user", respond: () => jsonResponse(200, SENDER) },
    ]));
    const req = createMockReq({ body: {}, token: "sender-token" });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });
});

describe("send-push: direct-message mode", () => {
  function routerFor({ messageRows, conversationRows, subscriptions = [] }) {
    return mockFetchRouter([
      { match: "/auth/v1/user", respond: () => jsonResponse(200, SENDER) },
      { match: "/rest/v1/direct_messages", respond: () => jsonResponse(200, messageRows) },
      { match: "/rest/v1/conversations", respond: () => jsonResponse(200, conversationRows) },
      { match: "/rest/v1/push_subscriptions", respond: (url, opts) =>
          opts.method === "DELETE" ? jsonResponse(200, []) : jsonResponse(200, subscriptions) },
    ]);
  }

  it("rejects a caller attempting to push a message they did not send (403)", async () => {
    global.fetch = vi.fn(routerFor({
      messageRows: [{ id: "m1", conversation_id: "c1", sender_id: "someone-else", body: "hi" }],
      conversationRows: [],
    }));
    const req = createMockReq({ body: { directMessageId: "m1" }, token: "sender-token" });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it("404s for an invalid/inaccessible message id (RLS would hide it) instead of guessing a recipient", async () => {
    global.fetch = vi.fn(routerFor({ messageRows: [], conversationRows: [] }));
    const req = createMockReq({ body: { directMessageId: "does-not-exist" }, token: "sender-token" });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });

  it("derives the recipient from the conversation and the title from the caller's own identity -- ignores any recipient/title/body the request tries to supply", async () => {
    global.fetch = vi.fn(routerFor({
      messageRows: [{ id: "m1", conversation_id: "c1", sender_id: SENDER.id, body: "the real message body" }],
      conversationRows: [{ participant_a_id: SENDER.id, participant_b_id: "recipient-uuid" }],
      subscriptions: [{ id: "sub1", endpoint: "https://fcm.example/1", p256dh: "p", auth_key: "a" }],
    }));
    const req = createMockReq({
      body: {
        directMessageId: "m1",
        // An attacker-shaped payload -- attempting to override who gets
        // notified and what they see. None of this should reach webpush.
        userId: "attacker-controlled-uuid",
        title: "FAKE TITLE",
        body: "FAKE BODY",
        url: "https://evil.example/phish",
      },
      token: "sender-token",
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    const [subscription, payloadJson] = webpush.sendNotification.mock.calls[0];
    expect(subscription.endpoint).toBe("https://fcm.example/1");
    const payload = JSON.parse(payloadJson);
    expect(payload.title).toBe(`New message from ${SENDER.email}`);
    expect(payload.body).toBe("the real message body");
    expect(payload.url).toBe("/#messages");
  });
});

describe("send-push: notification-event mode", () => {
  function routerFor({ notificationRows, deliveryRows = [], knownUserRows, subscriptions = [] }) {
    return mockFetchRouter([
      { match: "/auth/v1/user", respond: () => jsonResponse(200, SENDER) },
      { match: "/rest/v1/notification_deliveries", respond: () => jsonResponse(200, deliveryRows) },
      { match: "/rest/v1/notifications", respond: () => jsonResponse(200, notificationRows) },
      { match: "/rest/v1/app_known_users", respond: () => jsonResponse(200, knownUserRows) },
      { match: "/rest/v1/push_subscriptions", respond: (url, opts) =>
          opts.method === "DELETE" ? jsonResponse(200, []) : jsonResponse(200, subscriptions) },
    ]);
  }

  it("404s on an invalid notificationId", async () => {
    global.fetch = vi.fn(routerFor({ notificationRows: [], knownUserRows: [] }));
    const req = createMockReq({ body: { notificationId: "bogus" }, token: "sender-token" });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });

  it("skips a recipient who has never signed into Ergon, without erroring", async () => {
    global.fetch = vi.fn(routerFor({
      notificationRows: [{ id: "n1", recipient_email: "ghost@nowhere.test", title: "Hi", body: "" }],
      knownUserRows: [],
    }));
    const req = createMockReq({ body: { notificationId: "n1" }, token: "sender-token" });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(false);
  });

  it("delivers using the stored notification's own title/body/recipient, ignoring a modified body in the request", async () => {
    global.fetch = vi.fn(routerFor({
      notificationRows: [{ id: "n1", recipient_email: "real@ergon.test", title: "Real title", body: "Real body", related_entity_type: "task" }],
      knownUserRows: [{ user_id: "real-user-uuid" }],
      subscriptions: [{ id: "sub1", endpoint: "https://fcm.example/2", p256dh: "p", auth_key: "a" }],
    }));
    const req = createMockReq({
      body: { notificationId: "n1", title: "SPOOFED", body: "SPOOFED BODY", userId: "someone-else" },
      token: "sender-token",
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(true);
    const payload = JSON.parse(webpush.sendNotification.mock.calls[0][1]);
    expect(payload.title).toBe("Real title");
    expect(payload.body).toBe("Real body");
    expect(payload.url).toBe("/#tasks");
  });

  it("does not re-deliver a notification that already has a recorded 'sent' push delivery", async () => {
    global.fetch = vi.fn(routerFor({
      notificationRows: [{ id: "n1", recipient_email: "real@ergon.test", title: "Real title", body: "" }],
      deliveryRows: [{ id: "delivery1" }],
      knownUserRows: [{ user_id: "real-user-uuid" }],
    }));
    const req = createMockReq({ body: { notificationId: "n1" }, token: "sender-token" });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(false);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
});

describe("send-push: rate limiting", () => {
  it("429s a caller who fires far more requests than a real UI could in a minute", async () => {
    global.fetch = vi.fn(mockFetchRouter([
      { match: "/auth/v1/user", respond: () => jsonResponse(200, { id: "rate-limit-test-user", email: "spammer@ergon.test" }) },
      { match: "/rest/v1/notifications", respond: () => jsonResponse(200, []) },
    ]));
    let lastStatus;
    for (let i = 0; i < 45; i += 1) {
      const req = createMockReq({ body: { notificationId: "n1" }, token: "spammer-token" });
      const r = createMockRes();
      await handler(req, r);
      lastStatus = r.statusCode;
    }
    expect(lastStatus).toBe(429);
  });
});
