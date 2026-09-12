import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  saveBuildTransactions,
  saveInventoryMovements,
  saveProjectAllocations,
  type BuildTransaction,
  type InventoryMovement,
  type ProjectAllocationHistory,
} from "./persistence";

// Overnight reliability closeout part 2 (2026-09-12, task 4): implements
// the already-decided product policy -- an unresolved equipment/project/
// build association must be shown as a rejection and require correction,
// never silently saved as null -- for the three functions where it can
// be done without changing historical records or business workflow
// (saveBuildTransactions, saveInventoryMovements, saveProjectAllocations).
//
// A blank/empty association (the user genuinely didn't specify one) is
// NOT a rejection case -- these three FKs are all nullable by design, and
// "not associated with anything" is a legitimate state. Only a NONEMPTY
// value that fails to resolve against a real row is rejected, and
// rejection always names the affected record and the unresolved value,
// and always rejects the WHOLE batch (never an arbitrary partial write),
// matching the same policy already used for saveInventoryMovements' own
// sku validation and migration 130/131's ambiguous-name rejection.
//
// Restore consequence (recorded separately, per instruction): these
// three functions are shared, unmodified, between the live save path and
// restoreFullBackupSnapshot. A restore snapshot containing one legacy
// record with a genuinely unresolvable historical name will now fail
// that ONE section (movementsBuildsAllocations) -- but since task 3's
// restructuring of restoreFullBackupSnapshot made every section
// independent, every OTHER section (inventory items, projects, purchase
// requests, documents) still restores successfully and is reported as
// such in the returned RestoreOutcome. This is a real, intentional
// behavior change for that one section on a restore containing bad
// historical data -- not a silent regression, and not blocked on a
// business decision, per this pass's explicit instruction to implement
// and record the consequence rather than treat it as a blocker.

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

describe("saveBuildTransactions -- equipment name resolution and rejection", () => {
  it("resolves by the recipe's own equipment_name (the original, always-supported case)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("equipment_types")) {
        return respond(true, 200, [{ id: "eq-1", equipment_name: "Test Recipe", output_inventory_item_id: "item-1", output_item: { item_name: "Test Recipe" } }]);
      }
      return respond(true, 200, [{ build_number: "BLD-1" }]);
    });
    globalThis.fetch = fetchMock;
    await expect(saveBuildTransactions([makeBuild()], "token")).resolves.toBeUndefined();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("build_transactions?on_conflict"));
    const body = JSON.parse((call![1] as { body: string }).body);
    expect(body[0]).toMatchObject({ equipment_type_id: "eq-1", finished_inventory_item_id: "item-1" });
  });

  it("FIXED: resolves by the recipe's OUTPUT name too (build.equipmentName is populated from outputName, not name)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("equipment_types")) {
        // The recipe's internal name is "Internal Recipe Name" (never
        // matches the build), but its output/title is "Renamed Title" --
        // this is exactly the rename-after-creation scenario that used to
        // silently null both FKs.
        return respond(true, 200, [{ id: "eq-1", equipment_name: "Internal Recipe Name", output_inventory_item_id: "item-1", output_item: { item_name: "Renamed Title" } }]);
      }
      return respond(true, 200, [{ build_number: "BLD-1" }]);
    });
    globalThis.fetch = fetchMock;
    await expect(saveBuildTransactions([makeBuild({ equipmentName: "Renamed Title" })], "token")).resolves.toBeUndefined();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("build_transactions?on_conflict"));
    const body = JSON.parse((call![1] as { body: string }).body);
    expect(body[0]).toMatchObject({ equipment_type_id: "eq-1", finished_inventory_item_id: "item-1" });
  });

  it("rejects the whole save, naming the build and the unresolved value, when equipmentName matches nothing", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("equipment_types")) return respond(true, 200, []);
      throw new Error("should not reach the write");
    });
    await expect(saveBuildTransactions([makeBuild({ equipmentName: "Nonexistent Equipment" })], "token")).rejects.toThrow(
      "Some build transactions could not be saved.",
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unresolved equipment name for build(s): BLD-1 (equipment "Nonexistent Equipment")'));
  });

  it("mixed batch: one resolved, one unresolved -- rejects the whole batch, names only the unresolved one", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("equipment_types")) {
        return respond(true, 200, [{ id: "eq-1", equipment_name: "Test Recipe", output_inventory_item_id: null, output_item: null }]);
      }
      throw new Error("should not reach the write");
    });
    await expect(
      saveBuildTransactions([makeBuild({ id: "b1", buildNumber: "BLD-1" }), makeBuild({ id: "b2", buildNumber: "BLD-2", equipmentName: "Ghost Equipment" })], "token"),
    ).rejects.toThrow("Some build transactions could not be saved.");
    const message = vi.mocked(console.error).mock.calls[0][0] as string;
    expect(message).toContain("BLD-2");
    expect(message).not.toContain("BLD-1 (");
  });

  it("case/whitespace differences are not treated as a match -- rejected as unresolved, not silently accepted", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("equipment_types")) {
        return respond(true, 200, [{ id: "eq-1", equipment_name: "Test Recipe", output_inventory_item_id: null, output_item: null }]);
      }
      throw new Error("should not reach the write");
    });
    await expect(saveBuildTransactions([makeBuild({ equipmentName: "  test recipe  " })], "token")).rejects.toThrow(
      "Some build transactions could not be saved.",
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unresolved equipment name for build(s): BLD-1 (equipment "  test recipe  ")'));
  });

  it("a blank equipmentName is tolerated (no equipment specified is a legitimate state, not a rejection)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("equipment_types")) return respond(true, 200, []);
      return respond(true, 200, [{ build_number: "BLD-1" }]);
    });
    globalThis.fetch = fetchMock;
    await expect(saveBuildTransactions([makeBuild({ equipmentName: "" })], "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
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

function installMovementLookups(overrides: { items?: unknown[]; projects?: unknown[]; builds?: unknown[] } = {}) {
  globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("inventory_items")) return respond(true, 200, overrides.items ?? [{ id: "item-1", sku: "SKU-1" }]);
    if (String(url).includes("projects")) return respond(true, 200, overrides.projects ?? []);
    if (String(url).includes("build_transactions")) return respond(true, 200, overrides.builds ?? []);
    return respond(true, 200, [{ legacy_id: "m1" }]);
  });
}

describe("saveInventoryMovements -- project/build name rejection", () => {
  it("rejects the whole save when projectName is nonempty but unresolved", async () => {
    installMovementLookups();
    await expect(saveInventoryMovements([makeMovement({ projectName: "Ghost Project" })], "token")).rejects.toThrow(
      "Some inventory movements could not be saved.",
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unresolved project/build for movement(s): m1 (project "Ghost Project")'));
  });

  it("rejects the whole save when buildNumber is nonempty but unresolved", async () => {
    installMovementLookups();
    await expect(saveInventoryMovements([makeMovement({ buildNumber: "BLD-GHOST" })], "token")).rejects.toThrow(
      "Some inventory movements could not be saved.",
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unresolved project/build for movement(s): m1 (build "BLD-GHOST")'));
  });

  it("mixed batch: one resolved, one with an unresolved project -- rejects the whole batch, names only the bad one", async () => {
    installMovementLookups({ items: [{ id: "item-1", sku: "SKU-1" }], projects: [{ id: "proj-1", project_name: "Real Project" }] });
    await expect(
      saveInventoryMovements(
        [makeMovement({ id: "m1", projectName: "Real Project" }), makeMovement({ id: "m2", projectName: "Fake Project" })],
        "token",
      ),
    ).rejects.toThrow("Some inventory movements could not be saved.");
    const message = vi.mocked(console.error).mock.calls[0][0] as string;
    expect(message).toContain("m2");
    expect(message).not.toContain("m1 (");
  });

  it("case/whitespace differences on a project name are rejected as unresolved, not silently matched", async () => {
    installMovementLookups({ projects: [{ id: "proj-1", project_name: "Real Project" }] });
    await expect(saveInventoryMovements([makeMovement({ projectName: "real project" })], "token")).rejects.toThrow(
      "Some inventory movements could not be saved.",
    );
  });

  it("a blank projectName/buildNumber is tolerated (legitimately unassociated)", async () => {
    installMovementLookups();
    await expect(saveInventoryMovements([makeMovement({ projectName: undefined, buildNumber: undefined })], "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
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

function installAllocationLookups(overrides: { items?: unknown[]; projects?: unknown[]; movements?: unknown[] } = {}) {
  globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("inventory_items")) return respond(true, 200, overrides.items ?? [{ id: "item-1", sku: "SKU-1" }]);
    if (String(url).includes("projects")) return respond(true, 200, overrides.projects ?? [{ id: "proj-1", project_name: "Project X" }]);
    if (String(url).includes("inventory_movements")) return respond(true, 200, overrides.movements ?? [{ id: "mv-1", legacy_id: "m1" }]);
    return respond(true, 200, [{ legacy_id: "a1" }]);
  });
}

describe("saveProjectAllocations -- sku/project/movement rejection", () => {
  it("rejects when sku is nonempty but unresolved", async () => {
    installAllocationLookups({ items: [] });
    await expect(saveProjectAllocations([makeAllocation()], "token")).rejects.toThrow("Some project allocations could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unresolved association for allocation(s): a1 (sku "SKU-1")'));
  });

  it("rejects when projectName is nonempty but unresolved", async () => {
    installAllocationLookups({ projects: [] });
    await expect(saveProjectAllocations([makeAllocation()], "token")).rejects.toThrow("Some project allocations could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unresolved association for allocation(s): a1 (project "Project X")'));
  });

  it("rejects when movementId is nonempty but unresolved", async () => {
    installAllocationLookups({ movements: [] });
    await expect(saveProjectAllocations([makeAllocation()], "token")).rejects.toThrow("Some project allocations could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unresolved association for allocation(s): a1 (movement "m1")'));
  });

  it("names every unresolved field together when more than one fails to resolve on the same allocation", async () => {
    installAllocationLookups({ items: [], projects: [] });
    await expect(saveProjectAllocations([makeAllocation()], "token")).rejects.toThrow("Some project allocations could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('a1 (sku "SKU-1", project "Project X")'));
  });

  it("mixed batch: one resolved, one unresolved -- rejects the whole batch, names only the bad one", async () => {
    installAllocationLookups();
    await expect(
      saveProjectAllocations(
        [makeAllocation({ id: "a1" }), makeAllocation({ id: "a2", projectName: "Ghost Project" })],
        "token",
      ),
    ).rejects.toThrow("Some project allocations could not be saved.");
    const message = vi.mocked(console.error).mock.calls[0][0] as string;
    expect(message).toContain("a2");
    expect(message).not.toContain("a1 (");
  });

  it("blank sku/projectName/movementId is tolerated (legitimately unassociated)", async () => {
    installAllocationLookups();
    await expect(
      saveProjectAllocations([makeAllocation({ sku: "", projectName: "", movementId: "" })], "token"),
    ).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});
