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
  it("rejects a request with no Authorization header at all", async () => {
    global.fetch = vi.fn(mockFetchRouter([]));
    const res = createMockRes();
    await handler(createMockReq({}), res);
    expect(res.statusCode).toBe(401);
    // The rejection response itself must never echo back anything that
    // could be mistaken for -- or leak -- the real secret.
    expect(JSON.stringify(res.body)).not.toContain("test-cron-secret");
  });

  it("rejects an incorrect secret", async () => {
    global.fetch = vi.fn(mockFetchRouter([]));
    const res = createMockRes();
    await handler(createMockReq({ token: "wrong-secret" }), res);
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain("test-cron-secret");
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

  it("does not include a task whose assignee is a role, not a real email (the live query itself filters assignee_email=not.is.null)", async () => {
    global.fetch = vi.fn(
      mockFetchRouter([
        // The real Supabase filter excludes role-only assignments server-side --
        // this mock simulates that by simply never returning such a row, the
        // same as production would.
        { match: "/rest/v1/tasks", respond: () => jsonResponse(200, []) },
      ]),
    );
    const res = createMockRes();
    await handler(createMockReq({ token: "test-cron-secret" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ scanned: 0, created: 0 });
  });

  it("a second run for the same overdue task on the same day creates zero new notifications (dedupe holds), and does not log it as a failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn(
      mockFetchRouter([
        {
          match: "/rest/v1/tasks",
          respond: () =>
            jsonResponse(200, [
              { id: "t1", title: "Overdue Task", due_date: "2026-01-01", assignee_email: "person@ergon.test" },
            ]),
        },
        // Live-verified 2026-09-08 against real production: without an
        // explicit on_conflict=<columns> query param, PostgREST does NOT
        // silently no-op a duplicate against a non-primary-key unique
        // index (idx_notifications_dedupe, migration 024) just because
        // `Prefer: resolution=ignore-duplicates` was sent -- a retried
        // insert against an already-used dedupe_key genuinely 409s. The
        // unique index is still what blocks the duplicate row either way.
        { match: "/rest/v1/notifications", respond: () => jsonResponse(409, { code: "23505", message: "duplicate key value violates unique constraint" }) },
      ]),
    );
    const res = createMockRes();
    await handler(createMockReq({ token: "test-cron-secret" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.scanned).toBe(1);
    expect(res.body.created).toBe(0);
    // A 409 here is dedupe working as intended, not a failure -- must not
    // show up in Vercel's error logs and cause false alarms on every
    // routine retried day.
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("a genuine (non-409) per-task insert failure IS logged clearly, distinct from routine dedupe", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn(
      mockFetchRouter([
        {
          match: "/rest/v1/tasks",
          respond: () =>
            jsonResponse(200, [
              { id: "t1", title: "Overdue Task", due_date: "2026-01-01", assignee_email: "person@ergon.test" },
            ]),
        },
        { match: "/rest/v1/notifications", respond: () => jsonResponse(503, { error: "service unavailable" }) },
      ]),
    );
    const res = createMockRes();
    await handler(createMockReq({ token: "test-cron-secret" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.created).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
    const loggedText = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedText).toContain("t1");
    expect(loggedText).toContain("503");
    expect(loggedText).not.toContain("test-cron-secret");
    errorSpy.mockRestore();
  });

  it("logs a clear failure when the overdue-task query itself fails, without ever logging the secret", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn(mockFetchRouter([{ match: "/rest/v1/tasks", respond: () => jsonResponse(500, { error: "db down" }) }]));
    const res = createMockRes();
    await handler(createMockReq({ token: "test-cron-secret" }), res);
    expect(res.statusCode).toBe(502);
    expect(errorSpy).toHaveBeenCalled();
    const loggedText = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedText).toContain("Could not load overdue tasks");
    expect(loggedText).not.toContain("test-cron-secret");
    errorSpy.mockRestore();
  });
});
