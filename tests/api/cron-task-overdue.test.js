import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockReq, createMockRes, mockFetchRouter, jsonResponse } from "./_test-helpers.js";

const handler = (await import("../../api/cron/task-overdue.js")).default;

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.CRON_SECRET = "test-cron-secret";
  vi.clearAllMocks();
});

describe("cron/task-overdue", () => {
  it("rejects a request without the real CRON_SECRET -- this has no signed-in user, only the secret gates it", async () => {
    global.fetch = vi.fn(mockFetchRouter([]));
    const res = createMockRes();
    await handler(createMockReq({ token: "wrong-secret" }), res);
    expect(res.statusCode).toBe(401);
  });

  it("scans overdue tasks and creates one notification per assignee, deduped per day", async () => {
    const inserted = [];
    global.fetch = vi.fn(
      mockFetchRouter([
        {
          match: "/rest/v1/tasks",
          respond: () =>
            jsonResponse(200, [
              { id: "t1", title: "Overdue Task", due_date: "2026-01-01", assignee_email: "person@ergon.test" },
            ]),
        },
        {
          match: "/rest/v1/notifications",
          respond: (url, opts) => {
            const body = JSON.parse(opts.body);
            const row = { id: `n${inserted.length + 1}`, ...body };
            inserted.push(row);
            return jsonResponse(201, [row]);
          },
        },
      ]),
    );
    const res = createMockRes();
    await handler(createMockReq({ token: "test-cron-secret" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.created).toBe(1);
    expect(inserted[0].recipient_email).toBe("person@ergon.test");
    expect(inserted[0].event_type).toBe("task_overdue");
  });
});
