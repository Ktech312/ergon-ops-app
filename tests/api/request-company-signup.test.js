import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockRes, jsonResponse, mockFetchRouter, systemHealthRpcHandlers } from "./_test-helpers.js";

const handler = (await import("../../api/request-company-signup.js")).default;

function mockReq({ body = {}, ip = "203.0.113.1" } = {}) {
  return {
    method: "POST",
    body,
    headers: { "x-forwarded-for": ip },
    socket: { remoteAddress: ip },
  };
}

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  vi.clearAllMocks();
});

describe("request-company-signup: input validation", () => {
  it("rejects a missing/blank companyName", async () => {
    global.fetch = vi.fn();
    const res = createMockRes();
    await handler(mockReq({ body: { companyName: "  ", requesterName: "Someone", requesterEmail: "someone@example.com" } }), res);
    expect(res.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a missing/blank requesterName", async () => {
    global.fetch = vi.fn();
    const res = createMockRes();
    await handler(mockReq({ body: { companyName: "Acme Co", requesterName: "", requesterEmail: "someone@example.com" } }), res);
    expect(res.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a malformed requesterEmail", async () => {
    global.fetch = vi.fn();
    const res = createMockRes();
    await handler(mockReq({ body: { companyName: "Acme Co", requesterName: "Someone", requesterEmail: "not-an-email" } }), res);
    expect(res.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a companyName over the length cap", async () => {
    global.fetch = vi.fn();
    const res = createMockRes();
    await handler(mockReq({ body: { companyName: "x".repeat(201), requesterName: "Someone", requesterEmail: "someone@example.com" } }), res);
    expect(res.statusCode).toBe(400);
  });
});

// No platform admins found -- the common case for tests that don't care
// about notification routing at all (mirrors systemHealthRpcHandlers()'s
// own "benign default" role, listed first in a test's own handler list
// wins when a test DOES care).
function noPlatformAdminsHandler() {
  return { match: "/rest/v1/rpc/get_platform_admin_emails", respond: () => jsonResponse(200, []) };
}

describe("request-company-signup: happy path", () => {
  it("submits with a normalized (lowercased) email and returns submitted:true", async () => {
    let capturedBody = null;
    global.fetch = vi.fn(
      mockFetchRouter([
        ...systemHealthRpcHandlers(),
        noPlatformAdminsHandler(),
        {
          match: "/rest/v1/rpc/submit_company_signup_request",
          respond: (url, options) => {
            capturedBody = JSON.parse(options.body);
            return jsonResponse(200, "11111111-1111-1111-1111-111111111111");
          },
        },
      ]),
    );
    const res = createMockRes();
    await handler(mockReq({ ip: "203.0.113.5", body: { companyName: "Acme Co", requesterName: "Jane Prospect", requesterEmail: "Jane@Example.com" } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ submitted: true });
    expect(capturedBody).toEqual({
      p_company_name: "Acme Co",
      p_requester_name: "Jane Prospect",
      p_requester_email: "jane@example.com",
    });
  });

  it("returns a generic 400 (never the raw Postgres error) when the RPC itself rejects the input", async () => {
    global.fetch = vi.fn(
      mockFetchRouter([
        ...systemHealthRpcHandlers(),
        noPlatformAdminsHandler(),
        { match: "/rest/v1/rpc/submit_company_signup_request", respond: () => jsonResponse(400, { message: "some internal detail that should never reach the client" }) },
      ]),
    );
    const res = createMockRes();
    await handler(mockReq({ ip: "203.0.113.6", body: { companyName: "Acme Co", requesterName: "Jane Prospect", requesterEmail: "jane2@example.com" } }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("internal detail");
  });
});

describe("request-company-signup: rate limiting", () => {
  it("429s after 10 requests from the same IP within the window, even with different emails", async () => {
    global.fetch = vi.fn(
      mockFetchRouter([
        ...systemHealthRpcHandlers(),
        noPlatformAdminsHandler(),
        { match: "/rest/v1/rpc/submit_company_signup_request", respond: () => jsonResponse(200, "22222222-2222-2222-2222-222222222222") },
      ]),
    );
    let lastStatus;
    for (let i = 0; i < 11; i += 1) {
      const res = createMockRes();
      await handler(mockReq({ ip: "203.0.113.9", body: { companyName: "Acme Co", requesterName: "Someone", requesterEmail: `rate-ip-${i}@example.com` } }), res);
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
  });

  it("429s after 3 requests for the same email within the window, even from different IPs", async () => {
    global.fetch = vi.fn(
      mockFetchRouter([
        ...systemHealthRpcHandlers(),
        noPlatformAdminsHandler(),
        { match: "/rest/v1/rpc/submit_company_signup_request", respond: () => jsonResponse(200, "33333333-3333-3333-3333-333333333333") },
      ]),
    );
    let lastStatus;
    for (let i = 0; i < 4; i += 1) {
      const res = createMockRes();
      await handler(mockReq({ ip: `203.0.114.${i}`, body: { companyName: "Acme Co", requesterName: "Someone", requesterEmail: "repeat-email@example.com" } }), res);
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
  });
});

// Login-page redesign spec, item 7: "Create a durable in-app notification
// for platform admins... Send the request notification to the configured
// Ergon platform-admin email... A mail failure must not lose the
// request... Do not notify ordinary company admins."
describe("request-company-signup: platform-admin notification routing", () => {
  it("creates one durable notifications row per real platform admin, addressed correctly", async () => {
    const createdNotifications = [];
    global.fetch = vi.fn(
      mockFetchRouter([
        ...systemHealthRpcHandlers(),
        { match: "/rest/v1/rpc/get_platform_admin_emails", respond: () => jsonResponse(200, [{ user_id: "admin-1", email: "platform-admin-1@ergon.example" }, { user_id: "admin-2", email: "platform-admin-2@ergon.example" }]) },
        { match: "/rest/v1/rpc/submit_company_signup_request", respond: () => jsonResponse(200, "44444444-4444-4444-4444-444444444444") },
        {
          match: "/rest/v1/notifications",
          respond: (url, options) => {
            createdNotifications.push(JSON.parse(options.body));
            return jsonResponse(200, [{ id: "notif-id" }]);
          },
        },
      ]),
    );
    const res = createMockRes();
    await handler(mockReq({ ip: "203.0.115.1", body: { companyName: "Acme Co", requesterName: "Jane Prospect", requesterEmail: "jane@acme.example" } }), res);

    expect(res.body).toEqual({ submitted: true });
    expect(createdNotifications).toHaveLength(2);
    expect(createdNotifications.map((n) => n.recipient_email).sort()).toEqual(["platform-admin-1@ergon.example", "platform-admin-2@ergon.example"]);
    for (const row of createdNotifications) {
      expect(row.event_type).toBe("company_signup_requested");
      expect(row.related_entity_type).toBe("company_signup_request");
      expect(row.related_entity_id).toBe("44444444-4444-4444-4444-444444444444");
      expect(row.title).toMatch(/new company signup/i);
      expect(row.body).toContain("Acme Co");
    }
  });

  it("never calls get_admin_emails (ordinary company admins) -- only get_platform_admin_emails", async () => {
    const calledUrls = [];
    global.fetch = vi.fn(async (url, options) => {
      calledUrls.push(String(url));
      return mockFetchRouter([
        ...systemHealthRpcHandlers(),
        noPlatformAdminsHandler(),
        { match: "/rest/v1/rpc/submit_company_signup_request", respond: () => jsonResponse(200, "55555555-5555-5555-5555-555555555555") },
      ])(url, options);
    });
    const res = createMockRes();
    await handler(mockReq({ ip: "203.0.115.2", body: { companyName: "Acme Co", requesterName: "Jane Prospect", requesterEmail: "jane3@acme.example" } }), res);

    expect(res.body).toEqual({ submitted: true });
    expect(calledUrls.some((u) => u.includes("get_platform_admin_emails"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("get_admin_emails") && !u.includes("get_platform_admin_emails"))).toBe(false);
  });

  it("attempts no notification and no crash when there are zero platform admins", async () => {
    global.fetch = vi.fn(
      mockFetchRouter([
        ...systemHealthRpcHandlers(),
        noPlatformAdminsHandler(),
        { match: "/rest/v1/rpc/submit_company_signup_request", respond: () => jsonResponse(200, "66666666-6666-6666-6666-666666666666") },
        { match: "/rest/v1/notifications", respond: () => { throw new Error("must not be called with zero platform admins"); } },
      ]),
    );
    const res = createMockRes();
    await handler(mockReq({ ip: "203.0.115.3", body: { companyName: "Acme Co", requesterName: "Jane Prospect", requesterEmail: "jane4@acme.example" } }), res);
    expect(res.body).toEqual({ submitted: true });
  });

  it("a mail failure does not lose the request -- submitted:true still returned, recorded to System Health instead", async () => {
    // No GMAIL_USER/RESEND_API_KEY set in this test env (beforeEach never
    // sets them) -- sendEmail's own "not configured" branch fires, the
    // exact real-world shape of a mail failure this item is about.
    let healthEventBody = null;
    global.fetch = vi.fn(
      mockFetchRouter([
        {
          match: "/rest/v1/rpc/record_system_health_event",
          respond: (url, options) => {
            healthEventBody = JSON.parse(options.body);
            return jsonResponse(200, { event_id: "test-event-id", alert_worthy: false });
          },
        },
        { match: "/rest/v1/rpc/record_system_health_recovery", respond: () => jsonResponse(200, { recovered: false, was_alerted: false }) },
        { match: "/rest/v1/rpc/get_platform_admin_emails", respond: () => jsonResponse(200, [{ user_id: "admin-1", email: "platform-admin-1@ergon.example" }]) },
        { match: "/rest/v1/rpc/submit_company_signup_request", respond: () => jsonResponse(200, "77777777-7777-7777-7777-777777777777") },
        { match: "/rest/v1/notifications", respond: () => jsonResponse(200, [{ id: "notif-id" }]) },
      ]),
    );
    const res = createMockRes();
    await handler(mockReq({ ip: "203.0.115.4", body: { companyName: "Acme Co", requesterName: "Jane Prospect", requesterEmail: "jane5@acme.example" } }), res);

    // The request itself is never lost, even though the email failed.
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ submitted: true });
    expect(healthEventBody).not.toBeNull();
    expect(healthEventBody.p_surface).toBe("company_signup_notification");
    expect(healthEventBody.p_failure_reason_code).toBe("email_send_failed");
    expect(healthEventBody.p_entity_id).toBe("77777777-7777-7777-7777-777777777777");
  });

  it("records a System Health event, and still returns submitted:true, when the platform-admin email lookup itself fails", async () => {
    let healthEventBody = null;
    global.fetch = vi.fn(
      mockFetchRouter([
        {
          match: "/rest/v1/rpc/record_system_health_event",
          respond: (url, options) => {
            healthEventBody = JSON.parse(options.body);
            return jsonResponse(200, { event_id: "test-event-id", alert_worthy: false });
          },
        },
        { match: "/rest/v1/rpc/record_system_health_recovery", respond: () => jsonResponse(200, { recovered: false, was_alerted: false }) },
        { match: "/rest/v1/rpc/get_platform_admin_emails", respond: () => jsonResponse(500, { message: "db error" }) },
        { match: "/rest/v1/rpc/submit_company_signup_request", respond: () => jsonResponse(200, "88888888-8888-8888-8888-888888888888") },
      ]),
    );
    const res = createMockRes();
    await handler(mockReq({ ip: "203.0.115.5", body: { companyName: "Acme Co", requesterName: "Jane Prospect", requesterEmail: "jane6@acme.example" } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ submitted: true });
    expect(healthEventBody.p_failure_reason_code).toBe("platform_admin_email_lookup_failed");
  });
});
