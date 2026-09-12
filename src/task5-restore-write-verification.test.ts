import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  saveBuildTransactions,
  saveInventoryMovements,
  saveProjectAllocations,
  restoreFullBackupSnapshot,
  type BuildTransaction,
  type InventoryMovement,
  type ProjectAllocationHistory,
  type PurchaseRequest,
  type ProjectDocument,
} from "./persistence";

// Overnight autonomous pass, task 5 (2026-09-11): a fresh trace of
// restoreFullBackupSnapshot found saveBuildTransactions, saveInventoryMovements,
// saveProjectAllocations, saveRestoredPurchaseRequests, and
// saveRestoredProjectDocuments' final writes were ALL completely unchecked
// -- some results weren't even assigned to a variable. Confirmed safe to
// fix as isolated response checks (not a redesign of the restore workflow)
// because every path to these five functions already has a real, handled
// failure channel: the live debounce-save effect (main.tsx) wraps
// saveMovementsBuildsAllocations in a .catch that sets a visible status,
// and restoreFullBackupSnapshot's only caller (handleImportBackup) already
// has a real try/catch with an honest, non-overclaiming failure message.
// These tests lock in the fix; they do not test the still-open,
// design-only items (checkpoints, structured per-step results, dry-run,
// reconciliation report) -- see PRODUCT_ERROR_VISIBILITY_AUDIT.md.

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

function makeBuild(overrides: Partial<BuildTransaction> = {}): BuildTransaction {
  return {
    id: "b1",
    buildNumber: "BLD-1",
    equipmentName: "Test Recipe",
    quantityBuilt: 1,
    componentMovements: [],
    status: "posted",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("saveBuildTransactions", () => {
  it("throws a plain message and logs detail when the POST fails outright", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("equipment_types")) return respond(true, 200, []);
      return respond(false, 500, { message: "db error" });
    });
    await expect(saveBuildTransactions([makeBuild()], "token")).rejects.toThrow("Some build transactions could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("saveBuildTransactions failed (500)"));
  });

  it("throws when the POST returns 200 OK but affects fewer rows than sent", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("equipment_types")) return respond(true, 200, []);
      return respond(true, 200, []);
    });
    await expect(saveBuildTransactions([makeBuild()], "token")).rejects.toThrow("Some build transactions could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("saveBuildTransactions returned 0 row(s), expected 1"));
  });

  it("does not throw when every row is genuinely saved", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("equipment_types")) return respond(true, 200, []);
      return respond(true, 200, [{ build_number: "BLD-1" }]);
    });
    await expect(saveBuildTransactions([makeBuild()], "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  // Correction (2026-09-11, review): a failed equipment_types lookup used
  // to silently degrade to an empty map, so every build got written with a
  // null equipment reference instead of the save failing -- these lock in
  // that the write now never happens when the prerequisite lookup fails.
  it("throws before writing when the equipment_types lookup fails outright (HTTP)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("equipment_types")) return respond(false, 500, { message: "db error" });
      return respond(true, 200, [{ build_number: "BLD-1" }]);
    });
    globalThis.fetch = fetchMock;
    await expect(saveBuildTransactions([makeBuild()], "token")).rejects.toThrow("Some build transactions could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("equipment_types lookup failed (500)"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("build_transactions?on_conflict"))).toBe(false);
  });

  it("throws before writing when the equipment_types lookup fails outright (network error)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("equipment_types")) throw new Error("network down");
      return respond(true, 200, [{ build_number: "BLD-1" }]);
    });
    globalThis.fetch = fetchMock;
    await expect(saveBuildTransactions([makeBuild()], "token")).rejects.toThrow("Some build transactions could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("equipment_types lookup network error"), expect.any(Error));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("build_transactions?on_conflict"))).toBe(false);
  });
});

function makeMovement(overrides: Partial<InventoryMovement> = {}): InventoryMovement {
  return {
    id: "m1",
    type: "receive",
    sku: "SKU-1",
    itemName: "Widget",
    quantity: 5,
    quantityBefore: 0,
    quantityAfter: 5,
    source: "inventory",
    notes: "",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("saveInventoryMovements", () => {
  it("throws a plain message and logs detail when the POST fails outright", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("inventory_items")) return respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]);
      if (String(url).includes("projects")) return respond(true, 200, []);
      if (String(url).includes("build_transactions")) return respond(true, 200, []);
      return respond(false, 500, { message: "db error" });
    });
    await expect(saveInventoryMovements([makeMovement()], "token")).rejects.toThrow("Some inventory movements could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("saveInventoryMovements failed (500)"));
  });

  it("throws when the POST returns 200 OK but affects zero rows", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("inventory_items")) return respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]);
      if (String(url).includes("projects")) return respond(true, 200, []);
      if (String(url).includes("build_transactions")) return respond(true, 200, []);
      return respond(true, 200, []);
    });
    await expect(saveInventoryMovements([makeMovement()], "token")).rejects.toThrow("Some inventory movements could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("saveInventoryMovements returned 0 row(s), expected 1"));
  });

  it("does not throw when every row is genuinely saved", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("inventory_items")) return respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]);
      if (String(url).includes("projects")) return respond(true, 200, []);
      if (String(url).includes("build_transactions")) return respond(true, 200, []);
      return respond(true, 200, [{ legacy_id: "m1" }]);
    });
    await expect(saveInventoryMovements([makeMovement()], "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  // Correction (2026-09-11, review): each of the three prerequisite lookups
  // used to collapse a failure into an empty array. inventory_item_id is
  // NOT NULL on inventory_movements (migration 001), so a failed
  // inventory_items lookup previously meant every movement was silently
  // dropped from the write with no error at all. These lock in that any
  // lookup failure now rejects before the destination write ever happens.
  it("throws before writing when the inventory_items lookup fails outright", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("inventory_items")) return respond(false, 500, { message: "db error" });
      if (String(url).includes("projects")) return respond(true, 200, []);
      if (String(url).includes("build_transactions")) return respond(true, 200, []);
      return respond(true, 200, [{ legacy_id: "m1" }]);
    });
    globalThis.fetch = fetchMock;
    await expect(saveInventoryMovements([makeMovement()], "token")).rejects.toThrow("Some inventory movements could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("inventory_items lookup failed (500)"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("inventory_movements?on_conflict"))).toBe(false);
  });

  it("throws before writing when the projects lookup fails outright", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("inventory_items")) return respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]);
      if (String(url).includes("projects")) return respond(false, 500, { message: "db error" });
      if (String(url).includes("build_transactions")) return respond(true, 200, []);
      return respond(true, 200, [{ legacy_id: "m1" }]);
    });
    globalThis.fetch = fetchMock;
    await expect(saveInventoryMovements([makeMovement({ projectName: "Project X" })], "token")).rejects.toThrow("Some inventory movements could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("projects lookup failed (500)"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("inventory_movements?on_conflict"))).toBe(false);
  });

  it("throws before writing when the build_transactions lookup fails outright", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("inventory_items")) return respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]);
      if (String(url).includes("projects")) return respond(true, 200, []);
      if (String(url).includes("build_transactions")) return respond(false, 500, { message: "db error" });
      return respond(true, 200, [{ legacy_id: "m1" }]);
    });
    globalThis.fetch = fetchMock;
    await expect(saveInventoryMovements([makeMovement({ buildNumber: "BLD-1" })], "token")).rejects.toThrow("Some inventory movements could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("build_transactions lookup failed (500)"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("inventory_movements?on_conflict"))).toBe(false);
  });

  // Correction (2026-09-11, review): a movement with a genuinely nonempty
  // sku that didn't resolve used to be silently filtered out of the write
  // (inventory_item_id is required, so it could never have been written
  // anyway) -- now the whole save is rejected up front, before any write,
  // naming the unresolved sku/movement.
  it("rejects the whole save before writing when a nonempty sku doesn't resolve", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("inventory_items")) return respond(true, 200, []); // no matching row for SKU-1
      if (String(url).includes("projects")) return respond(true, 200, []);
      if (String(url).includes("build_transactions")) return respond(true, 200, []);
      return respond(true, 200, [{ legacy_id: "m1" }]);
    });
    globalThis.fetch = fetchMock;
    await expect(saveInventoryMovements([makeMovement({ id: "m1", sku: "SKU-1" })], "token")).rejects.toThrow("Some inventory movements could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("unresolved sku for movement(s): m1 (sku SKU-1)"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("inventory_movements?on_conflict"))).toBe(false);
  });

  // Correction (2026-09-11, review): a movement with a missing or
  // whitespace-only sku used to be silently filtered out of the write --
  // the same data-loss shape this pass exists to remove. Now rejected
  // before any lookup or write is attempted at all, not just before the
  // destination write.
  it("rejects before any network request when a movement has no sku at all", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(saveInventoryMovements([makeMovement({ id: "m1", sku: "" })], "token")).rejects.toThrow("Some inventory movements could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("missing/blank sku for movement(s): m1"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only sku the same as a missing one", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(saveInventoryMovements([makeMovement({ id: "m1", sku: "   " })], "token")).rejects.toThrow("Some inventory movements could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("missing/blank sku for movement(s): m1"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects the whole batch, before any network request, when only one of several movements is missing a sku", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(
      saveInventoryMovements(
        [makeMovement({ id: "m1", sku: "SKU-1" }), makeMovement({ id: "m2", sku: "" }), makeMovement({ id: "m3", sku: "SKU-3" })],
        "token",
      ),
    ).rejects.toThrow("Some inventory movements could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("missing/blank sku for movement(s): m2"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function makeAllocation(overrides: Partial<ProjectAllocationHistory> = {}): ProjectAllocationHistory {
  return {
    id: "a1",
    projectName: "Project X",
    sku: "SKU-1",
    itemName: "Widget",
    quantity: 5,
    movementId: "m1",
    action: "allocated",
    notes: "",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("saveProjectAllocations", () => {
  it("throws a plain message and logs detail when the POST fails outright", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("inventory_items")) return respond(true, 200, []);
      if (String(url).includes("projects")) return respond(true, 200, []);
      if (String(url).includes("inventory_movements")) return respond(true, 200, []);
      return respond(false, 500, { message: "db error" });
    });
    await expect(saveProjectAllocations([makeAllocation()], "token")).rejects.toThrow("Some project allocations could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("saveProjectAllocations failed (500)"));
  });

  it("throws when the POST returns 200 OK but affects zero rows", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("inventory_items")) return respond(true, 200, []);
      if (String(url).includes("projects")) return respond(true, 200, []);
      if (String(url).includes("inventory_movements")) return respond(true, 200, []);
      return respond(true, 200, []);
    });
    await expect(saveProjectAllocations([makeAllocation()], "token")).rejects.toThrow("Some project allocations could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("saveProjectAllocations returned 0 row(s), expected 1"));
  });

  it("does not throw when every row is genuinely saved", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("inventory_items")) return respond(true, 200, []);
      if (String(url).includes("projects")) return respond(true, 200, []);
      if (String(url).includes("inventory_movements")) return respond(true, 200, []);
      return respond(true, 200, [{ legacy_id: "a1" }]);
    });
    await expect(saveProjectAllocations([makeAllocation()], "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  // Correction (2026-09-11, review): each of the three prerequisite lookups
  // used to collapse a failure into an empty array. Unlike
  // saveInventoryMovements, all three FKs here (project_id,
  // inventory_item_id, movement_id on project_allocation_history,
  // migration 003) are genuinely nullable, so a NAME that doesn't match
  // still safely resolves to null and is not tested as a rejection case
  // here -- only an outright lookup failure is.
  it("throws before writing when the inventory_items lookup fails outright", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("inventory_items")) return respond(false, 500, { message: "db error" });
      if (String(url).includes("projects")) return respond(true, 200, []);
      if (String(url).includes("inventory_movements")) return respond(true, 200, []);
      return respond(true, 200, [{ legacy_id: "a1" }]);
    });
    globalThis.fetch = fetchMock;
    await expect(saveProjectAllocations([makeAllocation()], "token")).rejects.toThrow("Some project allocations could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("inventory_items lookup failed (500)"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("project_allocation_history?on_conflict"))).toBe(false);
  });

  it("throws before writing when the projects lookup fails outright", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("inventory_items")) return respond(true, 200, []);
      if (String(url).includes("projects")) return respond(false, 500, { message: "db error" });
      if (String(url).includes("inventory_movements")) return respond(true, 200, []);
      return respond(true, 200, [{ legacy_id: "a1" }]);
    });
    globalThis.fetch = fetchMock;
    await expect(saveProjectAllocations([makeAllocation()], "token")).rejects.toThrow("Some project allocations could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("projects lookup failed (500)"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("project_allocation_history?on_conflict"))).toBe(false);
  });

  it("throws before writing when the inventory_movements lookup fails outright", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("inventory_items")) return respond(true, 200, []);
      if (String(url).includes("projects")) return respond(true, 200, []);
      if (String(url).includes("inventory_movements")) return respond(false, 500, { message: "db error" });
      return respond(true, 200, [{ legacy_id: "a1" }]);
    });
    globalThis.fetch = fetchMock;
    await expect(saveProjectAllocations([makeAllocation()], "token")).rejects.toThrow("Some project allocations could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("inventory_movements lookup failed (500)"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("project_allocation_history?on_conflict"))).toBe(false);
  });
});

function makePurchaseRequest(overrides: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return {
    id: "pr1",
    requestNumber: "PR-1",
    sku: "SKU-1",
    itemName: "Widget",
    quantity: 5,
    reason: "Manual",
    estimatedUnitCost: 10,
    status: "Draft",
    createdAt: "2026-01-01T00:00:00Z",
    notes: "",
    ...overrides,
  };
}

describe("saveRestoredPurchaseRequests (via restoreFullBackupSnapshot)", () => {
  it("propagates a failed restore of purchase requests as a real thrown error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(restoreFullBackupSnapshot({ purchaseRequests: [makePurchaseRequest()] }, "token")).rejects.toThrow(
      "Some purchase requests could not be restored.",
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("saveRestoredPurchaseRequests failed (500)"));
  });

  it("propagates a zero-rows-affected restore as a real thrown error, not a false success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    await expect(restoreFullBackupSnapshot({ purchaseRequests: [makePurchaseRequest()] }, "token")).rejects.toThrow(
      "Some purchase requests could not be restored.",
    );
  });

  it("does not throw when the restore genuinely succeeds", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, [{ id: "pr1" }]));
    await expect(restoreFullBackupSnapshot({ purchaseRequests: [makePurchaseRequest()] }, "token")).resolves.toBeUndefined();
  });
});

function makeProjectDocument(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    id: "doc1",
    name: "Test.pdf",
    project: "Project X",
    size: 1024,
    status: "Uploaded",
    ...overrides,
  } as ProjectDocument;
}

// Correction (2026-09-11, review): saveRestoredProjectDocuments used to
// retry ANY 400 after stripping uploaded_by_email from the payload, on the
// theory that column might not exist yet. Migrations 068 (uploaded_by_email)
// and 080 (purchase_order_id/purchase_request_id) are both confirmed applied
// in production, so that fallback could only ever turn an unrelated
// validation error into a second request that silently omitted provenance
// and reported success anyway. The fallback is removed entirely -- these
// tests replace the old fallback-specific ones and lock in: a 400 is
// reported as a real failure and is NOT retried; the request happens
// exactly once; uploaded_by_email (and purchase_order_id/purchase_request_id,
// newly added to the restore payload to match the live per-document create
// path) survive in the one request that is made; and a genuine success
// still resolves cleanly.
describe("saveRestoredProjectDocuments (via restoreFullBackupSnapshot)", () => {
  it("reports a 400 as a real failure and does not retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(false, 400, { message: "some unrelated validation error" }));
    globalThis.fetch = fetchMock;
    await expect(restoreFullBackupSnapshot({ projectDocuments: [makeProjectDocument()] }, "token")).rejects.toThrow(
      "Some project documents could not be restored.",
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("saveRestoredProjectDocuments failed (400)"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a non-400 failure as a real thrown error, also with exactly one request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    globalThis.fetch = fetchMock;
    await expect(restoreFullBackupSnapshot({ projectDocuments: [makeProjectDocument()] }, "token")).rejects.toThrow(
      "Some project documents could not be restored.",
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("saveRestoredProjectDocuments failed (500)"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps uploaded_by_email (and the purchase order/request links) in the single request sent", async () => {
    let sentBody: unknown;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: { body: string }) => {
      sentBody = JSON.parse(options.body);
      return respond(true, 200, [{ id: "doc1" }]);
    });
    globalThis.fetch = fetchMock;
    await restoreFullBackupSnapshot(
      { projectDocuments: [makeProjectDocument({ uploadedByEmail: "e@x.com", purchaseOrderId: "po-1", purchaseRequestId: "pr-1" })] },
      "token",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rows = sentBody as Array<{ uploaded_by_email: string | null; purchase_order_id: string | null; purchase_request_id: string | null }>;
    expect(rows[0].uploaded_by_email).toBe("e@x.com");
    expect(rows[0].purchase_order_id).toBe("po-1");
    expect(rows[0].purchase_request_id).toBe("pr-1");
  });

  it("does not throw when the restore genuinely succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, [{ id: "doc1" }]));
    globalThis.fetch = fetchMock;
    await expect(restoreFullBackupSnapshot({ projectDocuments: [makeProjectDocument()] }, "token")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
