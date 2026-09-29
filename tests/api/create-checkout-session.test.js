import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockReq, createMockRes, mockFetchRouter, jsonResponse } from "./_test-helpers.js";

const sessionsCreate = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function StripeMock() {
    return { checkout: { sessions: { create: sessionsCreate } } };
  }),
}));

const handler = (await import("../../api/create-checkout-session.js")).default;

const SUPABASE_URL = "https://test.supabase.co";
const ADMIN = { id: "admin-uuid", email: "admin@ergon.test" };
const WORKSPACE_ID = "ws-1";

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = SUPABASE_URL;
  process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  vi.clearAllMocks();
});

function routerFor({ checkoutEnabled = true, ctx, plan } = {}) {
  return mockFetchRouter([
    { match: "/auth/v1/user", respond: () => jsonResponse(200, ADMIN) },
    { match: "/rest/v1/rpc/get_my_billing_context", respond: () => jsonResponse(200, [ctx]) },
    { match: "/rest/v1/billing_settings", respond: () => jsonResponse(200, [{ checkout_enabled: checkoutEnabled }]) },
    { match: "/rest/v1/billing_plans", respond: () => jsonResponse(200, plan ? [plan] : []) },
  ]);
}

describe("create-checkout-session: cross-cutting", () => {
  it("signed-out caller: 401", async () => {
    global.fetch = vi.fn(mockFetchRouter([{ match: "/auth/v1/user", respond: () => jsonResponse(401, {}) }]));
    const res = createMockRes();
    await handler(createMockReq({ body: { planKey: "starter", interval: "monthly" } }), res);
    expect(res.statusCode).toBe(401);
  });

  it("missing planKey: 400", async () => {
    global.fetch = vi.fn(routerFor({}));
    const res = createMockRes();
    await handler(createMockReq({ body: { interval: "monthly" }, token: "t" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("invalid interval: 400", async () => {
    global.fetch = vi.fn(routerFor({}));
    const res = createMockRes();
    await handler(createMockReq({ body: { planKey: "starter", interval: "weekly" }, token: "t" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("a non-admin caller is rejected", async () => {
    global.fetch = vi.fn(routerFor({ ctx: { workspace_id: WORKSPACE_ID, is_admin: false, status: "trialing", stripe_subscription_id: null, stripe_customer_id: null } }));
    const res = createMockRes();
    await handler(createMockReq({ body: { planKey: "starter", interval: "monthly" }, token: "t" }), res);
    expect(res.statusCode).toBe(403);
  });
});

describe("create-checkout-session: production-disabled gates", () => {
  it("checkout_enabled=false blocks creation even for a valid admin/plan", async () => {
    global.fetch = vi.fn(routerFor({
      checkoutEnabled: false,
      ctx: { workspace_id: WORKSPACE_ID, is_admin: true, status: "trialing", stripe_subscription_id: null, stripe_customer_id: null },
      plan: { plan_key: "starter", stripe_monthly_price_id: "price_123", stripe_annual_price_id: null },
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { planKey: "starter", interval: "monthly" }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.error).toMatch(/not yet available/i);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("a plan with no Stripe Price ID configured blocks creation even when checkout_enabled=true", async () => {
    global.fetch = vi.fn(routerFor({
      checkoutEnabled: true,
      ctx: { workspace_id: WORKSPACE_ID, is_admin: true, status: "trialing", stripe_subscription_id: null, stripe_customer_id: null },
      plan: { plan_key: "starter", stripe_monthly_price_id: null, stripe_annual_price_id: null },
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { planKey: "starter", interval: "monthly" }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.error).toMatch(/pricing has not been finalized/i);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});

describe("create-checkout-session: duplicate-subscription prevention", () => {
  it("a workspace with an existing active subscription is redirected to the portal, never given a second Checkout session", async () => {
    global.fetch = vi.fn(routerFor({
      checkoutEnabled: true,
      ctx: { workspace_id: WORKSPACE_ID, is_admin: true, status: "active", stripe_subscription_id: "sub_existing", stripe_customer_id: "cus_existing" },
      plan: { plan_key: "starter", stripe_monthly_price_id: "price_123", stripe_annual_price_id: null },
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { planKey: "starter", interval: "monthly" }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.redirectToPortal).toBe(true);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("creates a real session (mocked Stripe) when fully configured and no existing subscription", async () => {
    sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/session/xyz" });
    global.fetch = vi.fn(routerFor({
      checkoutEnabled: true,
      ctx: { workspace_id: WORKSPACE_ID, is_admin: true, status: "trialing", stripe_subscription_id: null, stripe_customer_id: null },
      plan: { plan_key: "starter", stripe_monthly_price_id: "price_123", stripe_annual_price_id: null },
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { planKey: "starter", interval: "monthly" }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBe("https://checkout.stripe.com/session/xyz");
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    const [args] = sessionsCreate.mock.calls[0];
    expect(args.client_reference_id).toBe(WORKSPACE_ID);
    expect(args.line_items[0].price).toBe("price_123");
    expect(args.mode).toBe("subscription");
  });
});
