import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadSystemHealthEvents, acknowledgeSystemHealthEvent, resolveSystemHealthEvent, recordSystemHealthEvent, recordSystemHealthRecovery } from "./persistence";

// System Health Phase B (2026-09-15, migration 151, PRODUCT_SYSTEM_HEALTH_PLAN.md
// §10): unlike Phase A's loadNotificationDeliveryFailures (which returns []
// on any failure), loadSystemHealthEvents deliberately THROWS on a failed
// fetch -- the design doc's own explicit rule is that a load failure must
// never silently read as "no active issues." Callers (main.tsx) catch this
// and keep the last-known-good array instead of clearing it. recordSystemHealthEvent
// is the opposite: it must NEVER throw, since it's called from inside other
// operations' own failure paths and must never itself cause a second failure.

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

describe("loadSystemHealthEvents", () => {
  it("returns an empty list when there are no active/acknowledged events", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    await expect(loadSystemHealthEvents("token")).resolves.toEqual([]);
  });

  it("throws on a failed request -- never silently returns [] (§10's rule)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(loadSystemHealthEvents("token")).rejects.toThrow();
  });

  it("maps a raw row to camelCase, including nullable fields", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(true, 200, [
        {
          id: "evt-1",
          surface: "backup_restore",
          entity_type: null,
          entity_id: null,
          failure_reason_code: "section_failed:projectDocuments",
          severity: "degraded",
          status: "active",
          occurrence_count: 3,
          first_seen_at: "2026-09-15T09:00:00Z",
          last_seen_at: "2026-09-15T10:00:00Z",
          resolved_at: null,
          acknowledged_by_email: null,
          safe_detail: { section: "projectDocuments" },
        },
      ]),
    );
    const result = await loadSystemHealthEvents("token");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "evt-1",
      surface: "backup_restore",
      failureReasonCode: "section_failed:projectDocuments",
      severity: "degraded",
      status: "active",
      occurrenceCount: 3,
      resolvedAt: null,
      acknowledgedByEmail: null,
      safeDetail: { section: "projectDocuments" },
    });
  });
});

describe("acknowledgeSystemHealthEvent / resolveSystemHealthEvent", () => {
  it("acknowledge returns ok:true on a successful RPC call", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, {}));
    await expect(acknowledgeSystemHealthEvent("evt-1", "token")).resolves.toMatchObject({ ok: true });
  });

  it("acknowledge returns ok:false with a message on a rejected RPC call (e.g. non-admin)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 400, { message: "Only an admin may acknowledge a System Health event." }));
    const result = await acknowledgeSystemHealthEvent("evt-1", "token");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("admin");
  });

  it("resolve returns ok:true on a successful RPC call", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, {}));
    await expect(resolveSystemHealthEvent("evt-1", "token")).resolves.toMatchObject({ ok: true });
  });
});

describe("recordSystemHealthEvent", () => {
  it("returns true on a successful RPC call", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, { event_id: "evt-1", alert_worthy: false }));
    await expect(
      recordSystemHealthEvent({ surface: "test_surface", failureReasonCode: "test_reason", severity: "info" }, "token"),
    ).resolves.toBe(true);
  });

  // Migration 152 (2026-09-16): the RPC now reports whether this call
  // crossed the alert threshold; when it does, the browser-side wrapper
  // fires the actual alert email via api/send-system-health-alert.js.
  it("POSTs to send-system-health-alert when the RPC reports alert_worthy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, { event_id: "evt-1", alert_worthy: true }));
    globalThis.fetch = fetchMock;
    await recordSystemHealthEvent({ surface: "test_surface", failureReasonCode: "test_reason", severity: "down" }, "token");
    const alertCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/send-system-health-alert"));
    expect(alertCall).toBeDefined();
    const body = JSON.parse((alertCall as [string, { body: string }])[1].body) as { kind: string; surface: string; failureReasonCode: string };
    expect(body.kind).toBe("alert");
    expect(body.surface).toBe("test_surface");
    expect(body.failureReasonCode).toBe("test_reason");
  });

  it("does NOT POST to send-system-health-alert when the RPC reports alert_worthy=false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, { event_id: "evt-1", alert_worthy: false }));
    globalThis.fetch = fetchMock;
    await recordSystemHealthEvent({ surface: "test_surface", failureReasonCode: "test_reason", severity: "info" }, "token");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/send-system-health-alert"))).toBe(false);
  });

  it("returns false (never throws) when the RPC call fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(
      recordSystemHealthEvent({ surface: "test_surface", failureReasonCode: "test_reason", severity: "info" }, "token"),
    ).resolves.toBe(false);
  });

  it("returns false (never throws) when fetch itself rejects", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      recordSystemHealthEvent({ surface: "test_surface", failureReasonCode: "test_reason", severity: "info" }, "token"),
    ).resolves.toBe(false);
  });

  it("returns false without calling fetch when no access token is available", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(
      recordSystemHealthEvent({ surface: "test_surface", failureReasonCode: "test_reason", severity: "info" }, undefined),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("recordSystemHealthRecovery", () => {
  it("returns true and sends a recovery notice when the RPC reports a recovered, previously-alerted incident", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, { recovered: true, was_alerted: true }));
    globalThis.fetch = fetchMock;
    await expect(
      recordSystemHealthRecovery({ surface: "test_surface", failureReasonCode: "test_reason" }, "token"),
    ).resolves.toBe(true);
    const recoveryCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/send-system-health-alert"));
    expect(recoveryCall).toBeDefined();
    const body = JSON.parse((recoveryCall as [string, { body: string }])[1].body) as { kind: string };
    expect(body.kind).toBe("recovery");
  });

  it("returns true but sends no notice when nothing needed recovering", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, { recovered: false, was_alerted: false }));
    globalThis.fetch = fetchMock;
    await expect(
      recordSystemHealthRecovery({ surface: "test_surface", failureReasonCode: "test_reason" }, "token"),
    ).resolves.toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/send-system-health-alert"))).toBe(false);
  });

  it("returns true but sends no notice when recovered but never alerted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, { recovered: true, was_alerted: false }));
    globalThis.fetch = fetchMock;
    await recordSystemHealthRecovery({ surface: "test_surface", failureReasonCode: "test_reason" }, "token");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/send-system-health-alert"))).toBe(false);
  });

  it("returns false (never throws) when the RPC call fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(
      recordSystemHealthRecovery({ surface: "test_surface", failureReasonCode: "test_reason" }, "token"),
    ).resolves.toBe(false);
  });

  it("returns false without calling fetch when no access token is available", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(
      recordSystemHealthRecovery({ surface: "test_surface", failureReasonCode: "test_reason" }, undefined),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
