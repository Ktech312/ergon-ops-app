import { describe, it, expect, beforeEach, vi } from "vitest";
import { restoreFullBackupSnapshot, type Part, type PurchaseRequest, type ProjectDocument } from "./persistence";

// Overnight reliability closeout (2026-09-12, task 3): restoreFullBackupSnapshot
// used to return Promise<void> and propagate the first thrown error
// straight out, aborting every later section regardless of whether it
// actually depended on the one that failed -- the caller could not tell
// which section failed, how many succeeded, or show anything more
// specific than a blanket "some information may already have been
// restored." These tests lock in the fix: each section runs
// independently (a failure in one does not block an unrelated later
// section from being attempted), the returned RestoreOutcome accurately
// reports per-section attempted/succeeded/count/error, a malformed
// snapshot is rejected before any write, and a retried restore of an
// already-once-saved project document is now deterministic (same
// document_number both times) instead of regenerating a new one from
// Date.now() every attempt.
//
// This does NOT make the restore atomic -- a section that itself
// partially writes before throwing still leaves that partial state
// committed. These tests use three of the six real sections
// (inventoryItems, purchaseRequests, projectDocuments) to exercise the
// orchestrator's own section-independence logic without needing to mock
// every dependency chain of the other three (deviceRecipes' RPC,
// projectSites' RPC, and the builds/movements/allocations chain) --
// each of those sections' own internal correctness is covered by its own
// dedicated test file.

function respond(ok: boolean, status: number, body: unknown) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function makePart(overrides: Partial<Part> = {}): Part {
  return {
    ref: "SKU-1",
    name: "Widget",
    description: "",
    manufacturer: "",
    category: "Base",
    cost: 10,
    stock: 5,
    reorderPoint: 0,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return {
    id: "req-1",
    requestNumber: "PR-1",
    sku: "SKU-1",
    itemName: "Widget",
    quantity: 1,
    reason: "Manual",
    estimatedUnitCost: 10,
    status: "Draft",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDocument(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    id: "doc-1",
    name: "site-plan.pdf",
    project: "Test Project",
    size: 1024,
    status: "Uploaded",
    ...overrides,
  };
}

type Routes = {
  items?: ReturnType<typeof respond>;
  locations?: ReturnType<typeof respond>;
  balances?: ReturnType<typeof respond>;
  purchaseRequests?: ReturnType<typeof respond>;
  projectDocuments?: ReturnType<typeof respond>;
};

function installRestoreRouter(routes: Routes) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const mock = vi.fn().mockImplementation(async (input, init?: { method?: string; body?: string }) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.includes("/inventory_items?on_conflict=sku")) {
      return routes.items ?? respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]);
    }
    if (url.includes("/locations?select=")) {
      return routes.locations ?? respond(true, 200, [{ id: "loc-1" }]);
    }
    if (url.includes("/inventory_balances?on_conflict=")) {
      return routes.balances ?? respond(true, 200, [{ inventory_item_id: "item-1" }]);
    }
    if (url.includes("/purchase_requests?on_conflict=id")) {
      return routes.purchaseRequests ?? respond(true, 200, [{ id: "req-1" }]);
    }
    if (url.includes("/project_documents?on_conflict=id")) {
      return routes.projectDocuments ?? respond(true, 200, [{ id: "doc-1" }]);
    }
    throw new Error(`Unmocked fetch call in test: ${init?.method ?? "GET"} ${url}`);
  });
  globalThis.fetch = mock;
  return calls;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("restoreFullBackupSnapshot -- complete success", () => {
  it("reports every attempted section as succeeded, with accurate counts, and skips sections the snapshot had nothing for", async () => {
    installRestoreRouter({ purchaseRequests: respond(true, 200, [{ id: "req-1" }, { id: "req-2" }]) });
    const outcome = await restoreFullBackupSnapshot(
      { inventoryItems: [makePart()], purchaseRequests: [makeRequest(), makeRequest({ id: "req-2" })], projectDocuments: [makeDocument()] },
      "token",
    );
    expect(outcome.ok).toBe(true);
    const bySection = Object.fromEntries(outcome.sections.map((s) => [s.section, s]));
    expect(bySection.inventoryItems).toMatchObject({ attempted: true, succeeded: true, count: 1 });
    expect(bySection.purchaseRequests).toMatchObject({ attempted: true, succeeded: true, count: 2 });
    expect(bySection.projectDocuments).toMatchObject({ attempted: true, succeeded: true, count: 1 });
    // Nothing in the snapshot for these -- skipped, not a failure.
    expect(bySection.deviceRecipes).toMatchObject({ attempted: false, count: 0 });
    expect(bySection.projectSites).toMatchObject({ attempted: false, count: 0 });
    expect(bySection.movementsBuildsAllocations).toMatchObject({ attempted: false, count: 0 });
  });
});

describe("restoreFullBackupSnapshot -- first-section failure does not block later independent sections", () => {
  it("attempts purchaseRequests and projectDocuments even though inventoryItems (the first section) failed", async () => {
    const calls = installRestoreRouter({ items: respond(false, 500, { message: "db error" }) });
    const outcome = await restoreFullBackupSnapshot(
      { inventoryItems: [makePart()], purchaseRequests: [makeRequest()], projectDocuments: [makeDocument()] },
      "token",
    );
    expect(outcome.ok).toBe(false);
    const bySection = Object.fromEntries(outcome.sections.map((s) => [s.section, s]));
    expect(bySection.inventoryItems).toMatchObject({ attempted: true, succeeded: false });
    expect(bySection.inventoryItems.error).toContain("Some inventory item details could not be saved.");
    expect(bySection.purchaseRequests).toMatchObject({ attempted: true, succeeded: true, count: 1 });
    expect(bySection.projectDocuments).toMatchObject({ attempted: true, succeeded: true, count: 1 });
    // Both later sections' requests genuinely went out, not skipped.
    expect(calls.some((c) => c.url.includes("/purchase_requests?on_conflict=id"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/project_documents?on_conflict=id"))).toBe(true);
  });
});

describe("restoreFullBackupSnapshot -- middle failure after an earlier committed section", () => {
  it("keeps an earlier section's success, records the middle failure, and still attempts the later section", async () => {
    installRestoreRouter({ purchaseRequests: respond(false, 500, { message: "constraint violation" }) });
    const outcome = await restoreFullBackupSnapshot(
      { inventoryItems: [makePart()], purchaseRequests: [makeRequest()], projectDocuments: [makeDocument()] },
      "token",
    );
    const bySection = Object.fromEntries(outcome.sections.map((s) => [s.section, s]));
    // Earlier section: succeeded, and that success is not erased by the
    // later failure.
    expect(bySection.inventoryItems).toMatchObject({ attempted: true, succeeded: true });
    // Middle section: failed, recorded honestly.
    expect(bySection.purchaseRequests).toMatchObject({ attempted: true, succeeded: false });
    // Later section: still attempted and succeeded, independent of the
    // middle failure.
    expect(bySection.projectDocuments).toMatchObject({ attempted: true, succeeded: true });
    expect(outcome.ok).toBe(false);
  });
});

describe("restoreFullBackupSnapshot -- malformed snapshot rejected before any write", () => {
  it("throws when a field that must be an array is some other type, before any fetch happens", async () => {
    const calls = installRestoreRouter({});
    await expect(
      restoreFullBackupSnapshot({ inventoryItems: "not an array" } as never, "token"),
    ).rejects.toThrow("This backup file's structure is invalid and cannot be restored.");
    expect(calls).toHaveLength(0);
  });

  it("throws for a malformed nested section even when other sections look fine", async () => {
    const calls = installRestoreRouter({});
    await expect(
      restoreFullBackupSnapshot({ purchaseRequests: [makeRequest()], projectDocuments: { not: "an array" } } as never, "token"),
    ).rejects.toThrow("This backup file's structure is invalid and cannot be restored.");
    expect(calls).toHaveLength(0);
  });
});

describe("restoreFullBackupSnapshot -- deterministic document-number retry", () => {
  it("sends the document's own real document_number both times, not a fresh Date.now()-based one on retry", async () => {
    const calls = installRestoreRouter({});
    const doc = makeDocument({ documentNumber: "DOC-000123" });
    await restoreFullBackupSnapshot({ projectDocuments: [doc] }, "token");
    await restoreFullBackupSnapshot({ projectDocuments: [doc] }, "token");
    const documentCalls = calls.filter((c) => c.url.includes("/project_documents?on_conflict=id"));
    expect(documentCalls).toHaveLength(2);
    const firstBody = documentCalls[0].body as Array<{ document_number: string }>;
    const secondBody = documentCalls[1].body as Array<{ document_number: string }>;
    expect(firstBody[0].document_number).toBe("DOC-000123");
    expect(secondBody[0].document_number).toBe("DOC-000123");
  });

  it("falls back to a generated number only for a legacy document with no recorded documentNumber", async () => {
    const calls = installRestoreRouter({});
    await restoreFullBackupSnapshot({ projectDocuments: [makeDocument({ documentNumber: undefined })] }, "token");
    const documentCalls = calls.filter((c) => c.url.includes("/project_documents?on_conflict=id"));
    const body = documentCalls[0].body as Array<{ document_number: string }>;
    expect(body[0].document_number).toMatch(/^DOC-RESTORE-/);
  });
});
