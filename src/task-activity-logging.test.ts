import { describe, it, expect, beforeEach, vi } from "vitest";
import { addTaskActivity } from "./persistence";

// PRODUCT_ERROR_VISIBILITY_AUDIT.md §7: `void addTaskActivity(...)`
// (main.tsx) is fire-and-forget, and addTaskActivity itself never checked
// response.ok -- the audit's own citation notes a real 503 on this exact
// endpoint already happened in production and was noticed only by
// accident during unrelated manual QA, not by any error-handling in the
// app. Task 9 of the 2026-09-11 overnight local-only pass: this stays
// best-effort (a logging failure must never block the task action that
// already succeeded) but now logs a real failure instead of vanishing.
//
// Corrected 2026-09-11 (same day, review): the first version of this fix
// logged the activity message itself (real business content, e.g. "Status
// changed to Done") as if it were the diagnostic detail. That's not
// useful for debugging and isn't what actually failed. Fixed to read and
// log the real response body instead, alongside the status and task id.

function mockFetchFail(status: number, body: unknown = { message: "server error" }) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("addTaskActivity", () => {
  it("does not throw on an HTTP failure (stays best-effort)", async () => {
    globalThis.fetch = mockFetchFail(503);
    await expect(addTaskActivity("task-1", "e@x.com", "Status changed", "token")).resolves.toBeUndefined();
  });

  it("logs the response body, status, and task id on an HTTP failure -- not the activity message", async () => {
    globalThis.fetch = mockFetchFail(503, { message: "constraint violation on task_activity_log" });
    await addTaskActivity("task-1", "e@x.com", "Status changed", "token");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("addTaskActivity failed for task task-1 (503): "),
    );
    const loggedMessage = vi.mocked(console.error).mock.calls[0][0] as string;
    expect(loggedMessage).toContain("constraint violation on task_activity_log");
    expect(loggedMessage).not.toContain("Status changed");
  });

  it("does not throw on a network failure and still logs it", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(addTaskActivity("task-1", "e@x.com", "Status changed", "token")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("addTaskActivity network error for task task-1:"), expect.any(Error));
  });

  it("does not log anything on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    await addTaskActivity("task-1", "e@x.com", "Status changed", "token");
    expect(console.error).not.toHaveBeenCalled();
  });
});
