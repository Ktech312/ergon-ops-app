import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockReq, createMockRes, mockFetchRouter, jsonResponse, systemHealthRpcHandlers } from "./_test-helpers.js";

const handler = (await import("../../api/respond-to-proposal.js")).default;

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  vi.clearAllMocks();
});

function reqWithIp(ip, body) {
  const req = createMockReq({ body });
  req.headers["x-forwarded-for"] = ip;
  return req;
}

describe("respond-to-proposal", () => {
  it("missing shareToken: 400, never calls the RPC", async () => {
    global.fetch = vi.fn(mockFetchRouter([...systemHealthRpcHandlers()]));
    const res = createMockRes();
    await handler(reqWithIp("203.0.113.1", { newStatus: "approved" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("invalid newStatus: 400, never calls the RPC", async () => {
    global.fetch = vi.fn(mockFetchRouter([...systemHealthRpcHandlers()]));
    const res = createMockRes();
    await handler(reqWithIp("203.0.113.1", { shareToken: "tok", newStatus: "not_a_real_status" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("passes the real client IP (first entry of x-forwarded-for) through to the RPC as approver_ip", async () => {
    let sentBody;
    global.fetch = vi.fn(
      mockFetchRouter([
        ...systemHealthRpcHandlers(),
        {
          match: "/rest/v1/rpc/respond_to_quote_proposal",
          respond: (url, opts) => {
            sentBody = JSON.parse(opts.body);
            return jsonResponse(200, [{ outcome: "success", status: "approved", responded_at: "2026-09-16T12:00:00Z", approval_name: "Jane", version: 1 }]);
          },
        },
      ]),
    );
    const res = createMockRes();
    // Multiple hops -- only the first (the real originating client) is used.
    await handler(reqWithIp("203.0.113.7, 10.0.0.1, 10.0.0.2", { shareToken: "tok", newStatus: "approved", approverName: "Jane" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ outcome: "success", status: "approved", responded_at: "2026-09-16T12:00:00Z", approval_name: "Jane", version: 1 }]);
    expect(sentBody.approver_ip).toBe("203.0.113.7");
    expect(sentBody.share_token).toBe("tok");
    expect(sentBody.new_status).toBe("approved");
  });

  it("never trusts a client-supplied approverIp/approval_ip field -- only the server-observed header is used", async () => {
    let sentBody;
    global.fetch = vi.fn(
      mockFetchRouter([
        ...systemHealthRpcHandlers(),
        {
          match: "/rest/v1/rpc/respond_to_quote_proposal",
          respond: (url, opts) => {
            sentBody = JSON.parse(opts.body);
            return jsonResponse(200, [{ outcome: "success", status: "approved", responded_at: null, approval_name: null, version: 1 }]);
          },
        },
      ]),
    );
    const res = createMockRes();
    await handler(reqWithIp("203.0.113.7", { shareToken: "tok", newStatus: "approved", approverIp: "1.2.3.4 (spoofed)" }), res);
    expect(res.statusCode).toBe(200);
    expect(sentBody.approver_ip).toBe("203.0.113.7");
  });

  it("RPC failure: 200 with outcome 'error' embedded (matches the frontend's existing error-mapping contract)", async () => {
    global.fetch = vi.fn(
      mockFetchRouter([...systemHealthRpcHandlers(), { match: "/rest/v1/rpc/respond_to_quote_proposal", respond: () => jsonResponse(500, { message: "db error" }) }]),
    );
    const res = createMockRes();
    await handler(reqWithIp("203.0.113.7", { shareToken: "tok", newStatus: "approved" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ outcome: "error" }]);
  });

  it("is rate-limited by IP after 20 requests in the window", async () => {
    global.fetch = vi.fn(
      mockFetchRouter([...systemHealthRpcHandlers(), { match: "/rest/v1/rpc/respond_to_quote_proposal", respond: () => jsonResponse(200, [{ outcome: "invalid_token", status: null, responded_at: null, approval_name: null, version: null }]) }]),
    );
    const uniqueIp = `198.51.100.${Date.now() % 200}`;
    for (let i = 0; i < 20; i += 1) {
      const res = createMockRes();
      await handler(reqWithIp(uniqueIp, { shareToken: "tok", newStatus: "approved" }), res);
      expect(res.statusCode).toBe(200);
    }
    const res = createMockRes();
    await handler(reqWithIp(uniqueIp, { shareToken: "tok", newStatus: "approved" }), res);
    expect(res.statusCode).toBe(429);
  });
});
