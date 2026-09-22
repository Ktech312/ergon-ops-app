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

describe("request-company-signup: happy path", () => {
  it("submits with a normalized (lowercased) email and returns submitted:true", async () => {
    let capturedBody = null;
    global.fetch = vi.fn(
      mockFetchRouter([
        ...systemHealthRpcHandlers(),
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
      mockFetchRouter([...systemHealthRpcHandlers(), { match: "/rest/v1/rpc/submit_company_signup_request", respond: () => jsonResponse(200, "22222222-2222-2222-2222-222222222222") }]),
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
      mockFetchRouter([...systemHealthRpcHandlers(), { match: "/rest/v1/rpc/submit_company_signup_request", respond: () => jsonResponse(200, "33333333-3333-3333-3333-333333333333") }]),
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
