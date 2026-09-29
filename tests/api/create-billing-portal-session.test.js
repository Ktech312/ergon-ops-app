import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockReq, createMockRes, mockFetchRouter, jsonResponse } from "./_test-helpers.js";

const portalSessionsCreate = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function StripeMock() {
    return { billingPortal: { sessions: { create: portalSessionsCreate } } };
  }),
}));

const handler = (await import("../../api/create-billing-portal-session.js")).default;

const SUPABASE_URL = "https://test.supabase.co";
const ADMIN = { id: "admin-uuid", email: "admin@ergon.test" };
const WORKSPACE_ID = "ws-1";

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = SUPABASE_URL;
  process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  vi.clearAllMocks();
});

function routerFor(ctx) {
  return mockFetchRouter([
    { match: "/auth/v1/user", respond: () => jsonResponse(200, ADMIN) },
    { match: "/rest/v1/rpc/get_my_billing_context", respond: () => jsonResponse(200, [ctx]) },
  ]);
}

describe("create-billing-portal-session", () => {
  it("signed-out caller: 401", async () => {
    global.fetch = vi.fn(mockFetchRouter([{ match: "/auth/v1/user", respond: () => jsonResponse(401, {}) }]));
    const res = createMockRes();
    await handler(createMockReq({}), res);
    expect(res.statusCode).toBe(401);
  });

  it("a non-admin caller is rejected", async () => {
    global.fetch = vi.fn(routerFor({ workspace_id: WORKSPACE_ID, is_admin: false, stripe_customer_id: "cus_1" }));
    const res = createMockRes();
    await handler(createMockReq({ token: "t" }), res);
    expect(res.statusCode).toBe(403);
  });

  it("a workspace with no Stripe customer yet cannot open the portal", async () => {
    global.fetch = vi.fn(routerFor({ workspace_id: WORKSPACE_ID, is_admin: true, stripe_customer_id: null }));
    const res = createMockRes();
    await handler(createMockReq({ token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.error).toMatch(/no billing account/i);
    expect(portalSessionsCreate).not.toHaveBeenCalled();
  });

  it("works for an already-blocked (unpaid) workspace -- this is the entire point of the endpoint", async () => {
    portalSessionsCreate.mockResolvedValue({ url: "https://billing.stripe.com/portal/xyz" });
    global.fetch = vi.fn(routerFor({ workspace_id: WORKSPACE_ID, is_admin: true, stripe_customer_id: "cus_1", status: "unpaid" }));
    const res = createMockRes();
    await handler(createMockReq({ token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBe("https://billing.stripe.com/portal/xyz");
    expect(portalSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1" }));
  });
});
