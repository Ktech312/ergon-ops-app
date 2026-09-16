import { describe, it, expect, beforeEach, vi } from "vitest";
import { recordNotificationDelivery } from "./persistence";

// PRODUCT_ERROR_VISIBILITY_AUDIT.md Addendum 2: recordNotificationDelivery
// -- the write behind the delivery-outcome telemetry a future System
// Health screen would read -- swallowed both network AND HTTP failures
// with zero signal at all (`.catch(() => undefined)`, no `.ok` check).
// A gap in this specific data would look identical to "nothing failed."
// These tests lock in the fix: it still never throws (this is a
// best-effort log alongside an already-sent/attempted notification, not
// the notification itself -- a logging failure must never be able to
// block or fail the real send), but a real failure is now at least
// logged instead of vanishing completely. Task 4 of the 2026-09-11
// overnight local-only pass: recipients/routing/dedup/delivery rules are
// untouched -- this function never decided any of those.
//
// Corrected 2026-09-11 (same day, review): the failure log only included
// the HTTP status, not the response body -- fixed to read and log the
// real body too, same as every other write-verification fix this pass.

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

describe("recordNotificationDelivery", () => {
  it("does not throw on an HTTP failure (stays best-effort, never blocks the real send)", async () => {
    globalThis.fetch = mockFetchFail(500);
    await expect(recordNotificationDelivery("notif-1", "email", "sent", undefined, "token")).resolves.toBeUndefined();
  });

  it("logs the response body alongside the status and notification id on an HTTP failure", async () => {
    globalThis.fetch = mockFetchFail(500, { message: "webhook endpoint returned 404" });
    await recordNotificationDelivery("notif-1", "slack", "failed", "webhook 404", "token");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("recordNotificationDelivery failed for notification notif-1 (slack) (500): "),
    );
    const loggedMessage = vi.mocked(console.error).mock.calls[0][0] as string;
    expect(loggedMessage).toContain("webhook endpoint returned 404");
  });

  it("does not throw on a network failure and still logs it", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(recordNotificationDelivery("notif-1", "push", "sent", undefined, "token")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("recordNotificationDelivery network error for notification notif-1 (push):"),
      expect.any(Error),
    );
  });

  it("does not log anything on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    await recordNotificationDelivery("notif-1", "email", "sent", undefined, "token");
    expect(console.error).not.toHaveBeenCalled();
  });

  // System Health Phase B (2026-09-16, Queue R1 item 1's second-ranked
  // call site): a genuine delivery failure also records a durable
  // System Health event, on top of the notification_deliveries row.
  describe("System Health Phase B wiring", () => {
    it("calls recordSystemHealthEvent with the correct surface/failure_reason_code on a failed delivery", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
      globalThis.fetch = fetchMock;
      await recordNotificationDelivery("notif-1", "slack", "failed", "webhook 404", "token");
      const healthEventCall = fetchMock.mock.calls.find(([url]) => String(url).includes("rpc/record_system_health_event"));
      expect(healthEventCall).toBeDefined();
      const body = JSON.parse((healthEventCall as [string, { body: string }])[1].body) as { p_surface: string; p_failure_reason_code: string; p_entity_id: string };
      expect(body.p_surface).toBe("notification_delivery");
      expect(body.p_failure_reason_code).toBe("channel_failed:slack");
      expect(body.p_entity_id).toBe("notif-1");
    });

    it("does not call recordSystemHealthEvent for a 'sent' or 'skipped' delivery", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
      globalThis.fetch = fetchMock;
      await recordNotificationDelivery("notif-1", "email", "sent", undefined, "token");
      await recordNotificationDelivery("notif-1", "email", "skipped", "no recipient", "token");
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("rpc/record_system_health_event"))).toBe(false);
    });
  });
});
