import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockRes, mockFetchRouter, jsonResponse } from "./_test-helpers.js";

const constructEvent = vi.fn();
const subscriptionsRetrieve = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function StripeMock() {
    return { webhooks: { constructEvent }, subscriptions: { retrieve: subscriptionsRetrieve } };
  }),
}));

const handler = (await import("../../api/stripe-webhook.js")).default;

const SUPABASE_URL = "https://test.supabase.co";

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
  vi.clearAllMocks();
});

// A minimal async-iterable fake req -- api/stripe-webhook.js reads the RAW body via
// `for await (const chunk of req)`, exactly like a real Vercel Node request with
// bodyParser disabled, rather than a pre-parsed req.body.
function fakeRawReq({ rawBody = "{}", signature = "t=1,v1=fake" } = {}) {
  return {
    method: "POST",
    headers: { "stripe-signature": signature },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(rawBody);
    },
  };
}

describe("stripe-webhook: signature verification", () => {
  it("rejects a missing/invalid signature with 400, no processing", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });
    const rpcSpy = vi.fn();
    global.fetch = rpcSpy;
    const res = createMockRes();
    await handler(fakeRawReq({ signature: "bad" }), res);
    expect(res.statusCode).toBe(400);
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

describe("stripe-webhook: event processing", () => {
  it("checkout.session.completed re-fetches the subscription fresh and calls process_stripe_webhook_event with the real current status", async () => {
    constructEvent.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { client_reference_id: "ws-1", customer: "cus_1", subscription: "sub_1" } },
    });
    subscriptionsRetrieve.mockResolvedValue({
      status: "trialing",
      current_period_end: 1735689600,
      items: { data: [{ price: { id: "price_starter_monthly" } }] },
    });
    const rpcCalls = [];
    global.fetch = vi.fn(mockFetchRouter([
      { match: "/rest/v1/billing_plans", respond: () => jsonResponse(200, [{ plan_key: "starter" }]) },
      { match: "/rest/v1/rpc/process_stripe_webhook_event", respond: (url, opts) => { rpcCalls.push(JSON.parse(opts.body)); return jsonResponse(200, "processed"); } },
    ]));
    const res = createMockRes();
    await handler(fakeRawReq(), res);
    expect(res.statusCode).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      p_stripe_event_id: "evt_1",
      p_workspace_id: "ws-1",
      p_new_status: "trialing",
      p_stripe_customer_id: "cus_1",
      p_stripe_subscription_id: "sub_1",
      p_plan_key: "starter",
    });
  });

  it("customer.subscription.deleted maps to status=canceled", async () => {
    constructEvent.mockReturnValue({
      id: "evt_2",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1", customer: "cus_1", metadata: { workspace_id: "ws-1" } } },
    });
    const rpcCalls = [];
    global.fetch = vi.fn(mockFetchRouter([
      { match: "/rest/v1/rpc/process_stripe_webhook_event", respond: (url, opts) => { rpcCalls.push(JSON.parse(opts.body)); return jsonResponse(200, "processed"); } },
    ]));
    const res = createMockRes();
    await handler(fakeRawReq(), res);
    expect(res.statusCode).toBe(200);
    expect(rpcCalls[0]).toMatchObject({ p_new_status: "canceled", p_workspace_id: "ws-1" });
  });

  it("an unrecognized event type still returns 200 without calling the state-changing RPC path", async () => {
    constructEvent.mockReturnValue({
      id: "evt_3",
      type: "invoice.paid",
      data: { object: {} },
    });
    const rpcCalls = [];
    global.fetch = vi.fn(mockFetchRouter([
      { match: "/rest/v1/rpc/process_stripe_webhook_event", respond: (url, opts) => { rpcCalls.push(JSON.parse(opts.body)); return jsonResponse(200, "processed_no_workspace"); } },
    ]));
    const res = createMockRes();
    await handler(fakeRawReq(), res);
    expect(res.statusCode).toBe(200);
    expect(rpcCalls[0].p_workspace_id).toBeNull();
    expect(rpcCalls[0].p_new_status).toBeNull();
  });

  it("a failed RPC call returns 500 so Stripe retries", async () => {
    constructEvent.mockReturnValue({
      id: "evt_4",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", customer: "cus_1", status: "active", metadata: { workspace_id: "ws-1" }, items: { data: [] } } },
    });
    global.fetch = vi.fn(mockFetchRouter([
      { match: "/rest/v1/rpc/process_stripe_webhook_event", respond: () => jsonResponse(500, { message: "db error" }) },
    ]));
    const res = createMockRes();
    await handler(fakeRawReq(), res);
    expect(res.statusCode).toBe(500);
  });
});
