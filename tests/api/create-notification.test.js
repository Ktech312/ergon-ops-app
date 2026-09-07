import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockReq, createMockRes, mockFetchRouter, jsonResponse } from "./_test-helpers.js";

const handler = (await import("../../api/create-notification.js")).default;

const CALLER = { id: "caller-uuid", email: "caller@ergon.test" };
const SUPABASE_URL = "https://test.supabase.co";

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = SUPABASE_URL;
  process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  vi.clearAllMocks();
});

// Builds a router covering the calls every handler needs, with sensible
// defaults (no role membership, nothing found) -- each test overrides
// only what it cares about via `overrides`, a map of URL substrings to
// respond functions.
function routerFor(overrides = {}) {
  const defaults = {
    "/auth/v1/user": () => jsonResponse(200, CALLER),
    "/rest/v1/app_admins": () => jsonResponse(200, []),
    "rpc/get_users_by_role": () => jsonResponse(200, []),
    "rpc/get_admin_emails": () => jsonResponse(200, []),
    "/rest/v1/notification_deliveries": () => jsonResponse(200, []),
  };
  const handlers = Object.entries({ ...defaults, ...overrides }).map(([match, respond]) => ({ match, respond }));
  return mockFetchRouter(handlers);
}

let insertedRows;
function withNotificationInsert(overrides = {}) {
  insertedRows = [];
  return routerFor({
    "/rest/v1/notifications": (url, opts) => {
      if (opts.method === "POST") {
        const body = JSON.parse(opts.body);
        // Simulate resolution=ignore-duplicates: a second insert with a
        // dedupe_key already seen returns an empty array, exactly like
        // real PostgREST does on a unique-index conflict.
        const alreadyExists = insertedRows.some((row) => row.dedupe_key === body.dedupe_key);
        if (alreadyExists) {
          return jsonResponse(201, []);
        }
        const row = { id: `notif-${insertedRows.length + 1}`, ...body };
        insertedRows.push(row);
        return jsonResponse(201, [row]);
      }
      return jsonResponse(200, []);
    },
    ...overrides,
  });
}

describe("create-notification: cross-cutting", () => {
  it("signed-out caller: 401", async () => {
    global.fetch = vi.fn(mockFetchRouter([{ match: "/auth/v1/user", respond: () => jsonResponse(401, {}) }]));
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "task_assigned", relatedEntityId: "t1" } }), res);
    expect(res.statusCode).toBe(401);
  });

  it("unsupported event type is rejected", async () => {
    global.fetch = vi.fn(routerFor());
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "not_a_real_event", relatedEntityId: "t1" }, token: "t" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("quote_proposal_responded/submittal_responded are rejected here -- they're server RPCs, not this route's job", async () => {
    global.fetch = vi.fn(routerFor());
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "quote_proposal_responded", relatedEntityId: "p1" }, token: "t" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("missing relatedEntityId is rejected", async () => {
    global.fetch = vi.fn(routerFor());
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "task_assigned" }, token: "t" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("a caller cannot override recipient/title/body -- only eventType + relatedEntityId are read for a real event", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/tasks": () => jsonResponse(200, [{ id: "t1", title: "Real Task", assignee_email: "real-assignee@ergon.test", assigned_role_key: null, deleted_at: null }]),
    }));
    const res = createMockRes();
    await handler(
      createMockReq({
        body: {
          eventType: "task_assigned",
          relatedEntityId: "t1",
          // Attacker-shaped extra fields -- none of this should reach the row.
          recipientEmail: "attacker@evil.test",
          title: "SPOOFED",
          body: "SPOOFED BODY",
        },
        token: "t",
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0].recipientEmail).toBe("real-assignee@ergon.test");
    expect(insertedRows[0].title).toBe("New task assigned");
    expect(insertedRows[0].title).not.toBe("SPOOFED");
    expect(insertedRows[0].recipient_email).toBe("real-assignee@ergon.test");
  });

  it("does not create a duplicate row for the same real event retried twice", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/tasks": () => jsonResponse(200, [{ id: "t1", title: "Real Task", assignee_email: "real-assignee@ergon.test", assigned_role_key: null, deleted_at: null }]),
    }));
    const res1 = createMockRes();
    await handler(createMockReq({ body: { eventType: "task_assigned", relatedEntityId: "t1" }, token: "t" }), res1);
    const res2 = createMockRes();
    await handler(createMockReq({ body: { eventType: "task_assigned", relatedEntityId: "t1" }, token: "t" }), res2);
    expect(res1.body.created).toHaveLength(1);
    expect(res2.body.created).toHaveLength(0);
    expect(insertedRows).toHaveLength(1);
  });
});

describe("create-notification: task_assigned / task_status_changed", () => {
  it("task_assigned: notifies the real assignee, 404s for a nonexistent task", async () => {
    global.fetch = vi.fn(withNotificationInsert({ "/rest/v1/tasks": () => jsonResponse(200, []) }));
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "task_assigned", relatedEntityId: "missing" }, token: "t" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("task_assigned: role-assigned task notifies every role member", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/tasks": () => jsonResponse(200, [{ id: "t1", title: "Team Task", assignee_email: null, assigned_role_key: "engineering", deleted_at: null }]),
      "rpc/get_users_by_role": () => jsonResponse(200, [{ user_id: "u1", email: "eng1@ergon.test" }, { user_id: "u2", email: "eng2@ergon.test" }]),
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "task_assigned", relatedEntityId: "t1" }, token: "t" }), res);
    expect(res.body.created.map((c) => c.recipientEmail).sort()).toEqual(["eng1@ergon.test", "eng2@ergon.test"]);
  });

  it("task_status_changed: notifies assignee and creator, excluding the acting user", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/tasks": () =>
        jsonResponse(200, [
          { id: "t1", title: "Real Task", status: "done", assignee_email: CALLER.email, assigned_role_key: null, created_by_email: "creator@ergon.test", deleted_at: null },
        ]),
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "task_status_changed", relatedEntityId: "t1" }, token: "t" }), res);
    // assignee === caller (the acting user) gets excluded; only the creator remains.
    expect(res.body.created.map((c) => c.recipientEmail)).toEqual(["creator@ergon.test"]);
  });
});

describe("create-notification: role-gated events", () => {
  it("purchase_request_status_changed: rejects a caller who isn't purchasing/admin", async () => {
    global.fetch = vi.fn(withNotificationInsert());
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "purchase_request_status_changed", relatedEntityId: "pr1" }, token: "t" }), res);
    expect(res.statusCode).toBe(403);
  });

  it("purchase_request_status_changed: authorized purchasing caller notifies requester + team", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "rpc/get_users_by_role": (url, opts) => {
        const body = JSON.parse(opts.body);
        return body.target_role === "purchasing"
          ? jsonResponse(200, [{ user_id: CALLER.id, email: CALLER.email }, { user_id: "u2", email: "purchasing2@ergon.test" }])
          : jsonResponse(200, []);
      },
      "/rest/v1/purchase_requests": () =>
        jsonResponse(200, [{ id: "pr1", request_number: "PR-1", item_name_snapshot: "Widget", status: "ordered", requested_by_email: "requester@ergon.test" }]),
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "purchase_request_status_changed", relatedEntityId: "pr1" }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    const recipients = res.body.created.map((c) => c.recipientEmail).sort();
    // caller (also a purchasing member) is excluded from their own notification.
    expect(recipients).toEqual(["purchasing2@ergon.test", "requester@ergon.test"]);
  });

  it("build_stage_changed: rejects a non-warehouse caller, and an unrecognized stage", async () => {
    global.fetch = vi.fn(withNotificationInsert());
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "build_stage_changed", relatedEntityId: "b1", stage: "tested" }, token: "t" }), res);
    expect(res.statusCode).toBe(403);
  });

  it("build_stage_changed: authorized warehouse caller, unrecognized stage rejected", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "rpc/get_users_by_role": () => jsonResponse(200, [{ user_id: CALLER.id, email: CALLER.email }, { user_id: "u1", email: "warehouse1@ergon.test" }]),
      "/rest/v1/build_transactions": () => jsonResponse(200, [{ id: "b1", build_number: "BLD-1" }]),
    }));
    const badStage = createMockRes();
    await handler(createMockReq({ body: { eventType: "build_stage_changed", relatedEntityId: "b1", stage: "not_a_real_stage" }, token: "t" }), badStage);
    expect(badStage.statusCode).toBe(400);

    const goodStage = createMockRes();
    await handler(createMockReq({ body: { eventType: "build_stage_changed", relatedEntityId: "b1", stage: "tested" }, token: "t" }), goodStage);
    expect(goodStage.statusCode).toBe(200);
    expect(goodStage.body.created[0].recipientEmail).toBe("warehouse1@ergon.test");
  });

  it("catalog_price_change_reviewed: rejects a non-manager caller", async () => {
    global.fetch = vi.fn(withNotificationInsert());
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "catalog_price_change_reviewed", relatedEntityId: "req1" }, token: "t" }), res);
    expect(res.statusCode).toBe(403);
  });
});

describe("create-notification: self-scoped events (cannot notify on someone else's behalf)", () => {
  it("catalog_price_change_requested: rejects reporting a request that isn't the caller's own", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/catalog_price_change_requests": () =>
        jsonResponse(200, [{ id: "req1", catalog_item_id: "c1", requested_by_email: "someone-else@ergon.test", field_changed: "unit_cost", previous_value: 1, requested_value: 2, reason: "x", status: "pending" }]),
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "catalog_price_change_requested", relatedEntityId: "req1" }, token: "t" }), res);
    expect(res.statusCode).toBe(403);
  });

  it("catalog_price_change_requested: the real requester can report their own request", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/catalog_price_change_requests": () =>
        jsonResponse(200, [{ id: "req1", catalog_item_id: "c1", requested_by_email: CALLER.email, field_changed: "unit_cost", previous_value: 1, requested_value: 2, reason: "x", status: "pending" }]),
      "/rest/v1/product_catalog": () => jsonResponse(200, [{ id: "c1", product_name: "Widget" }]),
      "rpc/get_users_by_role": () => jsonResponse(200, [{ user_id: "u1", email: "manager1@ergon.test" }]),
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "catalog_price_change_requested", relatedEntityId: "req1" }, token: "t" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.created[0].recipientEmail).toBe("manager1@ergon.test");
  });

  it("user_signup_pending: rejects reporting someone else's sign-up", async () => {
    global.fetch = vi.fn(withNotificationInsert());
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "user_signup_pending", relatedEntityId: "someone-else-uuid" }, token: "t" }), res);
    expect(res.statusCode).toBe(403);
  });

  it("user_signup_pending: rejects when no real pending row exists", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/app_user_status": () => jsonResponse(200, []),
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "user_signup_pending", relatedEntityId: CALLER.id }, token: "t" }), res);
    expect(res.statusCode).toBe(409);
  });

  it("user_signup_pending: a real pending row notifies every admin", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/app_user_status": () => jsonResponse(200, [{ user_id: CALLER.id, approval_status: "pending" }]),
      "rpc/get_admin_emails": () => jsonResponse(200, [{ user_id: "a1", email: "admin1@ergon.test" }, { user_id: "a2", email: "admin2@ergon.test" }]),
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "user_signup_pending", relatedEntityId: CALLER.id }, token: "t" }), res);
    expect(res.body.created.map((c) => c.recipientEmail).sort()).toEqual(["admin1@ergon.test", "admin2@ergon.test"]);
  });
});

describe("create-notification: low_stock_reached (re-derives the real number, doesn't trust a claim)", () => {
  it("rejects when the item genuinely isn't at/below its reorder point", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/inventory_items": () => jsonResponse(200, [{ id: "item1", sku: "SKU-1", item_name: "Widget", reorder_point: 5, track_reorder: true }]),
      "/rest/v1/inventory_balances": () => jsonResponse(200, [{ quantity_on_hand: 100, quantity_allocated: 0 }]),
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "low_stock_reached", relatedEntityId: "SKU-1" }, token: "t" }), res);
    expect(res.statusCode).toBe(409);
  });

  it("notifies purchasing+warehouse+admins when genuinely at/below reorder point", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/inventory_items": () => jsonResponse(200, [{ id: "item1", sku: "SKU-1", item_name: "Widget", reorder_point: 5, track_reorder: true }]),
      "/rest/v1/inventory_balances": () => jsonResponse(200, [{ quantity_on_hand: 2, quantity_allocated: 0 }]),
      "rpc/get_users_by_role": (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.target_role === "purchasing") return jsonResponse(200, [{ user_id: "u1", email: "purchasing1@ergon.test" }]);
        if (body.target_role === "warehouse") return jsonResponse(200, [{ user_id: "u2", email: "warehouse1@ergon.test" }]);
        return jsonResponse(200, []);
      },
      "rpc/get_admin_emails": () => jsonResponse(200, [{ user_id: "a1", email: "admin1@ergon.test" }]),
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "low_stock_reached", relatedEntityId: "SKU-1" }, token: "t" }), res);
    expect(res.body.created.map((c) => c.recipientEmail).sort()).toEqual(["admin1@ergon.test", "purchasing1@ergon.test", "warehouse1@ergon.test"]);
  });
});

describe("create-notification: mentioned", () => {
  it("task mentions: parses @role and @firstname from the real (re-fetched) task description", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/tasks": () => jsonResponse(200, [{ id: "t1", title: "Task", description: "cc @Sales and @Nate please", deleted_at: null }]),
      "/rest/v1/team_members": () => jsonResponse(200, [{ full_name: "Nate Wolfe", email: "nate@ergon.test" }]),
      "rpc/get_users_by_role": (url, opts) => {
        const body = JSON.parse(opts.body);
        return body.target_role === "sales" ? jsonResponse(200, [{ user_id: "u1", email: "sales1@ergon.test" }]) : jsonResponse(200, []);
      },
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "mentioned", relatedEntityType: "task", relatedEntityId: "t1" }, token: "t" }), res);
    expect(res.body.created.map((c) => c.recipientEmail).sort()).toEqual(["nate@ergon.test", "sales1@ergon.test"]);
  });

  it("channel_message mentions: a non-member (RLS hides the row) cannot trigger a mention notification", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/channel_messages": () => jsonResponse(200, []), // RLS-filtered to empty for a non-member
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "mentioned", relatedEntityType: "channel_message", relatedEntityId: "m1" }, token: "t" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("unsupported mention source is rejected", async () => {
    global.fetch = vi.fn(withNotificationInsert());
    const res = createMockRes();
    await handler(createMockReq({ body: { eventType: "mentioned", relatedEntityType: "not_a_real_source", relatedEntityId: "x1" }, token: "t" }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe("create-notification: direct_message_received (directMessageId mode)", () => {
  it("rejects a caller who isn't the message's real sender", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/direct_messages": () => jsonResponse(200, [{ id: "m1", conversation_id: "c1", sender_id: "someone-else", body: "hi" }]),
    }));
    const res = createMockRes();
    await handler(createMockReq({ body: { directMessageId: "m1" }, token: "t" }), res);
    expect(res.statusCode).toBe(403);
  });

  it("creates a notification for the real conversation partner, ignoring any spoofed fields", async () => {
    global.fetch = vi.fn(withNotificationInsert({
      "/rest/v1/direct_messages": () => jsonResponse(200, [{ id: "m1", conversation_id: "c1", sender_id: CALLER.id, body: "the real message" }]),
      "/rest/v1/conversations": () => jsonResponse(200, [{ participant_a_id: CALLER.id, participant_b_id: "recipient-uuid" }]),
      "/rest/v1/app_known_users": () => jsonResponse(200, [{ email: "real-recipient@ergon.test" }]),
    }));
    const res = createMockRes();
    await handler(
      createMockReq({ body: { directMessageId: "m1", recipientEmail: "attacker@evil.test", title: "SPOOFED" }, token: "t" }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.created[0].recipientEmail).toBe("real-recipient@ergon.test");
    expect(insertedRows[0].title).toContain(CALLER.email);
    expect(insertedRows[0].title).not.toBe("SPOOFED");
    expect(insertedRows[0].body).toBe("the real message");
  });
});
