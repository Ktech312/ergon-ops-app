import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadNotificationDeliveryFailures } from "./persistence";

// System Health Phase A (2026-09-12, overnight reliability closeout part
// 2, task 5): built entirely from the existing notification_deliveries/
// notifications tables -- no migration. These tests lock in the
// aggregation: one row per (channel, event type, failure reason), with
// an accurate occurrence count and first/last-seen timestamps, not one
// row per raw delivery attempt.

function respond(ok: boolean, status: number, body: unknown) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("loadNotificationDeliveryFailures", () => {
  it("returns an empty list when there are no failures", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    await expect(loadNotificationDeliveryFailures("token")).resolves.toEqual([]);
  });

  it("returns an empty list on a failed request (never throws)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(loadNotificationDeliveryFailures("token")).resolves.toEqual([]);
  });

  it("aggregates repeated identical failures into one row with an accurate count and first/last-seen", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(true, 200, [
        { channel: "slack", error_message: "channel not found", sent_at: "2026-09-12T09:00:00Z", notification: { event_type: "task_overdue", recipient_email: "later@example.com" } },
        { channel: "slack", error_message: "channel not found", sent_at: "2026-09-11T09:00:00Z", notification: { event_type: "task_overdue", recipient_email: "middle@example.com" } },
        { channel: "slack", error_message: "channel not found", sent_at: "2026-09-10T09:00:00Z", notification: { event_type: "task_overdue", recipient_email: "earliest@example.com" } },
      ]),
    );
    const result = await loadNotificationDeliveryFailures("token");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      channel: "slack",
      eventType: "task_overdue",
      failureReason: "channel not found",
      occurrenceCount: 3,
      firstOccurredAt: "2026-09-10T09:00:00Z",
      lastOccurredAt: "2026-09-12T09:00:00Z",
      lastRecipientEmail: "later@example.com",
    });
  });

  it("keeps distinct (channel, event, reason) combinations as separate rows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(true, 200, [
        { channel: "slack", error_message: "channel not found", sent_at: "2026-09-12T09:00:00Z", notification: { event_type: "task_overdue", recipient_email: "a@example.com" } },
        { channel: "email", error_message: "invalid recipient", sent_at: "2026-09-12T09:05:00Z", notification: { event_type: "low_stock_reached", recipient_email: "b@example.com" } },
      ]),
    );
    const result = await loadNotificationDeliveryFailures("token");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.channel).sort()).toEqual(["email", "slack"]);
  });

  it("falls back to a plain label when the notification join or error message is missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(true, 200, [{ channel: "push", error_message: null, sent_at: "2026-09-12T09:00:00Z", notification: null }]),
    );
    const result = await loadNotificationDeliveryFailures("token");
    expect(result[0]).toMatchObject({ eventType: "unknown", failureReason: "No error detail recorded", lastRecipientEmail: "" });
  });
});
