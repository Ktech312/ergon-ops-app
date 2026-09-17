import { describe, it, expect, beforeEach, vi } from "vitest";
import { computeSnapshotHash, startOrResumeRestoreRun, finalizeRestoreRun, cancelRestoreRun, restoreFullBackupSnapshot, type RestoreRunCheckpoint } from "./persistence";

// D9 (approved 2026-09-16, migration 154): resumable, per-section
// checkpointing. Every existing restoreFullBackupSnapshot call (every
// test in task5-restore-write-verification.test.ts) passes no
// checkpoint at all and is completely unaffected -- these tests cover
// only the NEW checkpoint-aware behavior.

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
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("computeSnapshotHash", () => {
  it("is deterministic -- the same text always hashes the same way", async () => {
    const a = await computeSnapshotHash('{"foo":"bar"}');
    const b = await computeSnapshotHash('{"foo":"bar"}');
    expect(a).toBe(b);
  });

  it("different text hashes differently", async () => {
    const a = await computeSnapshotHash('{"foo":"bar"}');
    const b = await computeSnapshotHash('{"foo":"baz"}');
    expect(a).not.toBe(b);
  });

  it("returns a 64-character hex string (SHA-256)", async () => {
    const hash = await computeSnapshotHash("some content");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("startOrResumeRestoreRun", () => {
  it("returns null without calling fetch when no access token is available", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(startOrResumeRestoreRun("hash1", undefined)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null (never throws) on a failed RPC call", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(startOrResumeRestoreRun("hash1", "token")).resolves.toBeNull();
  });

  it("maps a successful response to the checkpoint shape", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(true, 200, {
        run_id: "run-1",
        resumed: true,
        sections: [{ section: "inventoryItems", status: "succeeded", warnings: null }],
      }),
    );
    const result = await startOrResumeRestoreRun("hash1", "token");
    expect(result).toEqual({
      runId: "run-1",
      resumed: true,
      sections: [{ section: "inventoryItems", status: "succeeded", warnings: null }],
    });
  });
});

describe("finalizeRestoreRun / cancelRestoreRun", () => {
  it("finalizeRestoreRun never throws on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(finalizeRestoreRun("run-1", "token")).resolves.toBeUndefined();
  });

  it("cancelRestoreRun returns true on success, false on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, {}));
    await expect(cancelRestoreRun("run-1", "token")).resolves.toBe(true);

    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 400, {}));
    await expect(cancelRestoreRun("run-1", "token")).resolves.toBe(false);
  });
});

describe("restoreFullBackupSnapshot with a checkpoint", () => {
  it("skips re-running an already-succeeded section entirely -- never calls its save function", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      // If this section were re-run, it would hit inventory_items --
      // failing this mock on purpose would prove a real bug, so instead
      // assert it never gets called at all (see the explicit check below).
      if (String(url).includes("rpc/update_restore_run_section") || String(url).includes("rpc/finalize_restore_run")) {
        return respond(true, 200, {});
      }
      throw new Error(`unexpected call: ${url}`);
    });
    globalThis.fetch = fetchMock;

    const checkpoint: RestoreRunCheckpoint = {
      runId: "run-1",
      resumed: true,
      sections: [{ section: "inventoryItems", status: "succeeded", warnings: null }],
    };
    const outcome = await restoreFullBackupSnapshot({ inventoryItems: [{ ref: "SKU-1", name: "Widget", description: "", manufacturer: "", category: "Base", cost: 0, stock: 1, reorderPoint: 0, trackReorder: false, tags: [], retired: false, purchaseUrls: [], priceHistory: [] }] }, "token", checkpoint);

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("inventory_items") && !String(url).includes("rpc/"))).toBe(false);
    const section = outcome.sections.find((s) => s.section === "inventoryItems");
    expect(section).toMatchObject({ succeeded: true });
  });

  it("records a section's outcome via update_restore_run_section as it completes, and finalizes at the end", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("rpc/update_restore_run_section") || String(url).includes("rpc/finalize_restore_run") || String(url).includes("rpc/record_system_health")) {
        return respond(true, 200, {});
      }
      return respond(true, 200, [{ id: "row-1" }]);
    });

    const checkpoint: RestoreRunCheckpoint = { runId: "run-1", resumed: false, sections: [] };
    await restoreFullBackupSnapshot(
      { purchaseRequests: [{ id: "pr1", requestNumber: "PR-1", sku: "SKU-1", itemName: "Widget", quantity: 1, reason: "Manual", status: "Draft", notes: "", createdAt: "2026-01-01T00:00:00Z", estimatedUnitCost: 0 }] },
      "token",
      checkpoint,
    );

    expect(calls.some((url) => url.includes("rpc/update_restore_run_section"))).toBe(true);
    expect(calls.some((url) => url.includes("rpc/finalize_restore_run"))).toBe(true);
  });
});
