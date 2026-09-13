import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createPurchaseOrder,
  addTaskHardwareDependency,
  updateTaskHardwareDependencyStatus,
  createPurchaseOrderReceipt,
  updatePurchaseOrderLineReceivedQty,
  createPurchaseRequestRemote,
  updatePurchaseRequestRemote,
  updateProjectLedgerInfo,
} from "./persistence";

// Overnight reliability closeout (2026-09-12, task 5): a fresh audit of
// daily-use write paths found several purchasing/receiving/task-hardware
// functions with a real, isolated gap -- a missing .ok check, missing
// technical logging, or (createPurchaseOrder specifically) a genuinely
// misleading success value -- each fixable without a migration, workflow
// change, or new product decision. These tests lock in that fix set. One
// function (updateTaskHardwareDependencyStatus) deliberately stays
// non-throwing: its caller is fire-and-forget with no .catch. A second,
// updateProjectLedgerInfo, WAS non-throwing here for the same caller-side-
// redesign-still-open reason -- Queue A10 (2026-09-12) shipped that
// redesign (createClientLedgerSaveQueue, persistence.ts), so it now throws
// like every other queued save; see its own describe block below.

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

describe("createPurchaseOrder -- purchase_order_lines write no longer fabricates success", () => {
  function installRouter(lineResponse: ReturnType<typeof respond>) {
    const mock = vi.fn().mockImplementation(async (input, init?: { method?: string }) => {
      const url = String(input);
      if (url.includes("/vendors?on_conflict=name")) {
        return respond(true, 200, [{ id: "vendor-1" }]);
      }
      if (url.includes("/purchase_orders") && init?.method === "POST") {
        return respond(true, 200, [{ id: "po-1" }]);
      }
      if (url.includes("/purchase_order_lines")) {
        return lineResponse;
      }
      throw new Error(`Unmocked fetch call in test: ${url}`);
    });
    globalThis.fetch = mock;
  }

  it("returns an empty lines array (not the client's unsaved draft data) and logs when the line-items write fails", async () => {
    installRouter(respond(false, 500, { message: "constraint violation" }));
    const created = await createPurchaseOrder(
      {
        number: "PO-1", vendor: "Acme", date: "2026-01-01", projectRef: "", status: "Ordered",
        subtotal: 100, tax: 0, shipping: 0, sourceFile: "", shipTo: "", paymentNote: "",
        lines: [{ name: "Widget", category: "Hardware", qty: 2, unitCost: 50 }],
      },
      "token",
    );
    expect(created?.lines).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("purchase_order_lines write failed for order po-1 (500)"));
  });

  it("returns the real saved lines when the write succeeds", async () => {
    installRouter(respond(true, 200, [{ id: "line-1", item_name: "Widget", category: "Hardware", quantity_ordered: 2, unit_cost: 50, line_total: 100, quantity_received: 0 }]));
    const created = await createPurchaseOrder(
      {
        number: "PO-1", vendor: "Acme", date: "2026-01-01", projectRef: "", status: "Ordered",
        subtotal: 100, tax: 0, shipping: 0, sourceFile: "", shipTo: "", paymentNote: "",
        lines: [{ name: "Widget", category: "Hardware", qty: 2, unitCost: 50 }],
      },
      "token",
    );
    expect(created?.lines).toEqual([expect.objectContaining({ name: "Widget", qty: 2 })]);
  });
});

describe("addTaskHardwareDependency -- logging and no-row check", () => {
  it("logs the real status/body and throws when the insert fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "constraint violation" }));
    await expect(
      addTaskHardwareDependency({ taskId: "task-1", projectBomLineId: null, inventoryItemId: "item-1", quantityRequired: 1 }, "token"),
    ).rejects.toThrow("Could not link hardware to task: 500");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("addTaskHardwareDependency: insert failed for task task-1 (500)"));
  });

  it("throws when the insert returns 200 OK but no row", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    await expect(
      addTaskHardwareDependency({ taskId: "task-1", projectBomLineId: null, inventoryItemId: "item-1", quantityRequired: 1 }, "token"),
    ).rejects.toThrow("Could not link hardware to task.");
  });
});

describe("updateTaskHardwareDependencyStatus -- logs but never throws (fire-and-forget caller)", () => {
  it("logs the real status/body on failure without throwing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updateTaskHardwareDependencyStatus("dep-1", "allocated", "token")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateTaskHardwareDependencyStatus: PATCH failed for dependency dep-1 (500)"));
  });

  it("does not log on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, {}));
    await updateTaskHardwareDependencyStatus("dep-1", "allocated", "token");
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("createPurchaseOrderReceipt -- logging on failure and on a no-row response", () => {
  it("logs and returns null when the insert fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    const result = await createPurchaseOrderReceipt({ purchaseOrderId: "po-1", itemName: "Widget", qty: 1 }, "token");
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("createPurchaseOrderReceipt: purchase_order_receipts insert failed for order po-1 (500)"));
  });

  it("logs and returns null when the insert returns 200 OK but no row", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    const result = await createPurchaseOrderReceipt({ purchaseOrderId: "po-1", itemName: "Widget", qty: 1 }, "token");
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("returned no row"));
  });
});

describe("updatePurchaseOrderLineReceivedQty -- logs on failure, still returns a boolean", () => {
  it("logs and returns false when the PATCH fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updatePurchaseOrderLineReceivedQty("line-1", 5, "token")).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updatePurchaseOrderLineReceivedQty: PATCH failed for line line-1 (500)"));
  });

  it("returns true and does not log on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, {}));
    await expect(updatePurchaseOrderLineReceivedQty("line-1", 5, "token")).resolves.toBe(true);
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("createPurchaseRequestRemote / updatePurchaseRequestRemote -- body logging", () => {
  it("createPurchaseRequestRemote logs the real body before throwing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "constraint violation" }));
    await expect(
      createPurchaseRequestRemote(
        { requestNumber: "PR-1", sku: "SKU-1", itemName: "Widget", quantity: 1, reason: "Manual", estimatedUnitCost: 10, status: "Draft", notes: "" },
        "token",
      ),
    ).rejects.toThrow("Could not save purchase request: 500");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("createPurchaseRequestRemote: insert failed (500)"));
  });

  it("updatePurchaseRequestRemote logs the real body before throwing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "constraint violation" }));
    await expect(updatePurchaseRequestRemote("req-1", { quantity: 5 }, "token")).rejects.toThrow("Could not update purchase request: 500");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updatePurchaseRequestRemote: PATCH failed for request req-1 (500)"));
  });

  it("updatePurchaseRequestRemote logs a 0-row response before throwing the permission message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    await expect(updatePurchaseRequestRemote("req-1", { quantity: 5 }, "token")).rejects.toThrow("That change didn't affect anything");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updatePurchaseRequestRemote: PATCH for request req-1 affected 0 rows"));
  });
});

describe("updateProjectLedgerInfo -- Queue A10: now throws, returns the confirmed row on success", () => {
  it("logs the real status/body and throws a plain message on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updateProjectLedgerInfo("proj-1", { kickoffDate: "2026-01-01" }, "token")).rejects.toThrow(
      "Some Client Ledger changes could not be saved.",
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateProjectLedgerInfo: PATCH failed for project proj-1 (500)"));
  });

  it("throws when the PATCH returns 200 OK but no row", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    await expect(updateProjectLedgerInfo("proj-1", { kickoffDate: "2026-01-01" }, "token")).rejects.toThrow(
      "Some Client Ledger changes could not be saved.",
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("affected 0 rows for project proj-1"));
  });

  it("returns the server's confirmed row and does not log on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(true, 200, [{ id: "proj-1", kickoff_date: "2026-01-01", warranty_expiration_date: null, added_to_ledger: true, ledger_bucket: "active" }]),
    );
    const result = await updateProjectLedgerInfo("proj-1", { kickoffDate: "2026-01-01" }, "token");
    expect(result).toEqual({ projectId: "proj-1", kickoffDate: "2026-01-01", warrantyExpirationDate: "", addedToLedger: true, ledgerBucket: "active" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("returns null (no-op) when there are no fields to update", async () => {
    globalThis.fetch = vi.fn();
    const result = await updateProjectLedgerInfo("proj-1", {}, "token");
    expect(result).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
