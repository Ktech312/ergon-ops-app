import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveInventoryItems, saveProjectSites, restoreFullBackupSnapshot, type Part, type ProjectSite } from "./persistence";

// PRODUCT_ERROR_VISIBILITY_AUDIT.md Addendum 2 (A2.1, 2026-09-10): two real
// partial-write risks, confirmed before this fix --
//
// - saveInventoryItems' inventory_balances write (stock on-hand/allocated)
//   had NO .ok check and NO row-count check, on either the primary attempt
//   or a since-removed migration-091 fallback retry. A failed write here
//   looked identical to a successful save -- "Inventory saved" could show
//   while on-hand/allocated quantities silently didn't update.
// - saveProjectSites' project_scope_of_work write had no check at all.
//   A failure there left a project's summary/preparation/installation/etc.
//   text unsaved with zero signal, while the project record itself
//   (already checked) looked fine.
//
// These tests lock in the fix, revised 2026-09-10 per E's review:
// - Both writes throw on an HTTP failure AND on a "successful" response
//   that wrote a row count different from what was sent -- fewer OR more,
//   not just fewer (`!==`, not `<`) -- since either shape is an integrity
//   failure, not a benign partial success.
// - The migration-091 "retry without quantity_allocated on any 400"
//   fallback is REMOVED, not just untriggered -- migration 091 is
//   confirmed live in production, and retrying on status code alone would
//   have masked an unrelated validation error behind an apparent success.
//   A dedicated test below proves an unrelated 400 is never retried.
// - Both writes log the real status/response body via console.error and
//   throw only a plain, implementation-detail-free message to the caller
//   ("Some inventory quantities could not be saved." /
//   "Some project details could not be saved.") -- no "Check RLS" or raw
//   database text reaches the user-facing error.
// - A thrown error still reaches a real caller (restoreFullBackupSnapshot)
//   instead of being swallowed, which is what stops a caller from ever
//   showing a false success message after a real partial write.
//
// Updated 2026-09-12: saveProjectSites' BOM lines are no longer a
// delete-then-reinsert pair of unchecked requests -- migration 131
// (replace_project_bom_lines) moved that into one atomic RPC call per
// project. See the dedicated "saveProjectSites -- BOM line RPC" describe
// block below for coverage of the new call shape; the scope-of-work tests
// in this file are otherwise unchanged.
//
// Also added 2026-09-11 (task 2, overnight local-only pass): the
// pre-existing inventory_items (item metadata) row-count check --
// tightened from `<` to `!==` after confirming an over-count is
// structurally impossible for this single-table on_conflict=sku upsert
// to produce as a false failure (see that describe block's own comment).

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

function makeSite(overrides: Partial<ProjectSite> = {}): ProjectSite {
  return {
    ref: "P-1",
    name: "Test Project",
    client: "Test Client",
    type: "Parking Garage",
    address: "123 Main St",
    owner: "PM Owner",
    status: "Planning",
    due: "",
    package: "",
    cameras: 0,
    allocated: 0,
    siteNotes: "",
    sow: {
      summary: "Summary text",
      preparation: "",
      infrastructure: "",
      installation: "",
      commissioning: "",
      fineTuning: "",
      assumptions: "",
      exclusions: "",
    },
    bom: [],
    ...overrides,
  };
}

// URL-matching (not call-order-matching) mock: saveInventoryItems calls
// getMainWarehouseLocationId, which caches its result in a module-level
// variable for the lifetime of this test file, so whether the `locations`
// endpoint is actually hit depends on test order, not on this file's own
// tests. Matching by URL substring instead of by call index makes every
// test correct regardless of that cache's state. Returns the mock itself
// so a test can assert on call counts (e.g. proving no retry happened).
function installFetchRouter(routes: {
  items?: ReturnType<typeof respond>;
  locations?: ReturnType<typeof respond>;
  balances?: ReturnType<typeof respond>;
  projects?: ReturnType<typeof respond>;
  scope?: ReturnType<typeof respond>;
  bomRpc?: ReturnType<typeof respond>;
}) {
  const mock = vi.fn().mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/inventory_items?on_conflict=sku")) {
      return routes.items ?? respond(true, 200, []);
    }
    if (url.includes("/locations?select=")) {
      return routes.locations ?? respond(true, 200, [{ id: "loc-1" }]);
    }
    if (url.includes("/inventory_balances?on_conflict=")) {
      return routes.balances ?? respond(true, 200, []);
    }
    if (url.includes("/projects?on_conflict=")) {
      return routes.projects ?? respond(true, 200, []);
    }
    if (url.includes("/project_scope_of_work?on_conflict=")) {
      return routes.scope ?? respond(true, 200, []);
    }
    if (url.includes("/rpc/replace_project_bom_lines")) {
      return routes.bomRpc ?? respond(true, 200, { projectId: "proj-1", updatedCount: 0, insertedCount: 0, deletedCount: 0, lines: [] });
    }
    throw new Error(`Unmocked fetch call in test: ${url}`);
  });
  globalThis.fetch = mock;
  return mock;
}

function callsMatching(mock: ReturnType<typeof installFetchRouter>, urlSubstring: string) {
  return mock.mock.calls.filter((call: unknown[]) => String(call[0]).includes(urlSubstring));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveInventoryItems -- inventory_items (item metadata) write verification", () => {
  // Task 2 of the 2026-09-11 overnight local-only pass: this pre-existing
  // check (2026-08-24 audit) already used `.ok` + a row-count check, just
  // with `<` instead of `!==`. Reviewed and confirmed safe to tighten to
  // `!==`: this is a single-table `on_conflict=sku` upsert, and Postgres
  // itself hard-errors on a duplicate sku within one payload rather than
  // silently returning extra rows, so there is no legitimate scenario
  // where this specific upsert returns more rows than were sent -- an
  // over-count is exactly as much a real integrity failure as an
  // under-count. Also brought the messages in line with the balance
  // write beside it: plain user-facing text, real detail in the log.
  it("throws a plain message and logs detail when the item write fails outright", async () => {
    installFetchRouter({ items: respond(false, 500, { message: "constraint violation" }) });
    await expect(saveInventoryItems([makePart()], "token")).rejects.toThrow("Some inventory item details could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("inventory_items write failed (500)"));
  });

  it("throws when the item write returns 200 OK but wrote zero rows", async () => {
    installFetchRouter({ items: respond(true, 200, []) });
    await expect(saveInventoryItems([makePart()], "token")).rejects.toThrow("Some inventory item details could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("returned 0 row(s), expected 1"));
  });

  it("throws when the item write returns fewer rows than sent for a multi-item batch", async () => {
    installFetchRouter({ items: respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]) });
    await expect(
      saveInventoryItems([makePart({ ref: "SKU-1" }), makePart({ ref: "SKU-2" })], "token"),
    ).rejects.toThrow("Some inventory item details could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("returned 1 row(s), expected 2"));
  });

  it("throws when the item write returns MORE rows than sent", async () => {
    installFetchRouter({
      items: respond(true, 200, [
        { id: "item-1", sku: "SKU-1" },
        { id: "item-1-dup", sku: "SKU-1" },
      ]),
    });
    await expect(saveInventoryItems([makePart()], "token")).rejects.toThrow("Some inventory item details could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("returned 2 row(s), expected 1"));
  });

  it("does not throw when every item row is exactly accounted for", async () => {
    installFetchRouter({
      items: respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]),
      balances: respond(true, 200, [{ inventory_item_id: "item-1" }]),
    });
    await expect(saveInventoryItems([makePart()], "token")).resolves.toBeUndefined();
  });
});

describe("saveInventoryItems -- inventory_balances write verification", () => {
  it("throws a plain message and logs the status/body when the balance write fails outright", async () => {
    installFetchRouter({
      items: respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]),
      balances: respond(false, 500, { message: "internal detail" }),
    });
    await expect(saveInventoryItems([makePart()], "token")).rejects.toThrow("Some inventory quantities could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("inventory_balances write failed (500)"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("internal detail"));
  });

  it("does not retry an unrelated 400 -- calls the balances endpoint exactly once, then throws", async () => {
    const fetchMock = installFetchRouter({
      items: respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]),
      balances: respond(false, 400, { message: "some unrelated validation error" }),
    });
    await expect(saveInventoryItems([makePart()], "token")).rejects.toThrow("Some inventory quantities could not be saved.");
    expect(callsMatching(fetchMock, "/inventory_balances?on_conflict=")).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("inventory_balances write failed (400)"));
  });

  it("throws and logs when the balance write returns 200 OK but wrote zero rows -- a successful response is not the same as a successful write", async () => {
    installFetchRouter({
      items: respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]),
      balances: respond(true, 200, []),
    });
    await expect(saveInventoryItems([makePart()], "token")).rejects.toThrow("Some inventory quantities could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("returned 0 row(s), expected 1"));
  });

  it("throws when the balance write returns 200 OK but wrote fewer rows than sent for a multi-item batch", async () => {
    installFetchRouter({
      items: respond(true, 200, [
        { id: "item-1", sku: "SKU-1" },
        { id: "item-2", sku: "SKU-2" },
      ]),
      balances: respond(true, 200, [{ inventory_item_id: "item-1" }]),
    });
    await expect(saveInventoryItems([makePart({ ref: "SKU-1" }), makePart({ ref: "SKU-2" })], "token")).rejects.toThrow(
      "Some inventory quantities could not be saved.",
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("returned 1 row(s), expected 2"));
  });

  it("throws when the balance write returns MORE rows than sent -- an unexpected count is an integrity failure either direction", async () => {
    installFetchRouter({
      items: respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]),
      balances: respond(true, 200, [{ inventory_item_id: "item-1" }, { inventory_item_id: "item-1" }]),
    });
    await expect(saveInventoryItems([makePart()], "token")).rejects.toThrow("Some inventory quantities could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("returned 2 row(s), expected 1"));
  });

  it("does not throw or log when every balance row is genuinely written", async () => {
    installFetchRouter({
      items: respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]),
      balances: respond(true, 200, [{ inventory_item_id: "item-1" }]),
    });
    await expect(saveInventoryItems([makePart()], "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("saveProjectSites -- projects write verification", () => {
  it("throws a plain message and logs the status/body when the projects write fails outright", async () => {
    installFetchRouter({ projects: respond(false, 500, { message: "constraint violation" }) });
    await expect(saveProjectSites([makeSite()], "token")).rejects.toThrow("Could not save projects: 500");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("saveProjectSites: projects write failed (500)"));
  });

  it("throws and logs when the projects write returns 200 OK but wrote fewer rows than sent", async () => {
    installFetchRouter({ projects: respond(true, 200, []) });
    await expect(saveProjectSites([makeSite()], "token")).rejects.toThrow("Some project changes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("returned 0 row(s), expected 1"));
  });
});

describe("saveProjectSites -- project_scope_of_work write verification", () => {
  it("throws a plain message and logs the status/body when the scope-of-work write fails outright", async () => {
    installFetchRouter({
      projects: respond(true, 200, [{ id: "proj-1", project_name: "Test Project" }]),
      scope: respond(false, 500, { message: "internal detail" }),
    });
    await expect(saveProjectSites([makeSite()], "token")).rejects.toThrow("Some project details could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("project_scope_of_work write failed (500)"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("internal detail"));
  });

  it("throws and logs when the scope-of-work write returns 200 OK but wrote zero rows", async () => {
    installFetchRouter({
      projects: respond(true, 200, [{ id: "proj-1", project_name: "Test Project" }]),
      scope: respond(true, 200, []),
    });
    await expect(saveProjectSites([makeSite()], "token")).rejects.toThrow("Some project details could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("returned 0 row(s), expected 1"));
  });

  it("does not throw, does not log, and proceeds to the BOM step, when scope of work is genuinely written", async () => {
    installFetchRouter({
      projects: respond(true, 200, [{ id: "proj-1", project_name: "Test Project" }]),
      scope: respond(true, 200, [{ project_id: "proj-1" }]),
    });
    await expect(saveProjectSites([makeSite()], "token")).resolves.toEqual([expect.objectContaining({ name: "Test Project", bom: [] })]);
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("saveProjectSites -- BOM line RPC (migration 131, replace_project_bom_lines)", () => {
  it("sends a new BOM line (no id yet) with id: null", async () => {
    const fetchMock = installFetchRouter({
      projects: respond(true, 200, [{ id: "proj-1", project_name: "Test Project" }]),
      scope: respond(true, 200, [{ project_id: "proj-1" }]),
      bomRpc: respond(true, 200, {
        projectId: "proj-1",
        updatedCount: 0,
        insertedCount: 1,
        deletedCount: 0,
        lines: [{ id: "line-1", item: "Widget", sku: "SKU-1", qty: 2, status: "Not started", requestSpeed: "Standard", po: null, notes: null, procurementTrack: "warehouse_stock", sentToPurchasingAt: null, shipTo: null }],
      }),
    });
    await saveProjectSites([makeSite({ bom: [{ item: "Widget", qty: 2, status: "Not started", requestSpeed: "Standard" }] })], "token");
    const rpcCall = fetchMock.mock.calls.find((call: unknown[]) => String(call[0]).includes("/rpc/replace_project_bom_lines"));
    const body = JSON.parse((rpcCall![1] as { body: string }).body);
    expect(body).toMatchObject({ p_project_id: "proj-1", p_lines: [expect.objectContaining({ id: null, item_name: "Widget" })] });
  });

  it("sends an existing BOM line's real id and sku", async () => {
    const fetchMock = installFetchRouter({
      projects: respond(true, 200, [{ id: "proj-1", project_name: "Test Project" }]),
      scope: respond(true, 200, [{ project_id: "proj-1" }]),
    });
    await saveProjectSites([makeSite({ bom: [{ id: "line-1", sku: "SKU-1", item: "Widget", qty: 2, status: "Not started", requestSpeed: "Standard" }] })], "token");
    const rpcCall = fetchMock.mock.calls.find((call: unknown[]) => String(call[0]).includes("/rpc/replace_project_bom_lines"));
    const body = JSON.parse((rpcCall![1] as { body: string }).body);
    expect(body).toMatchObject({ p_lines: [expect.objectContaining({ id: "line-1", sku: "SKU-1" })] });
  });

  it("backfills the RPC's returned line id/sku into the returned site", async () => {
    installFetchRouter({
      projects: respond(true, 200, [{ id: "proj-1", project_name: "Test Project" }]),
      scope: respond(true, 200, [{ project_id: "proj-1" }]),
      bomRpc: respond(true, 200, {
        projectId: "proj-1",
        updatedCount: 0,
        insertedCount: 1,
        deletedCount: 0,
        lines: [{ id: "line-1", item: "Widget", sku: "SKU-1", qty: 2, status: "Not started", requestSpeed: "Standard", po: null, notes: null, procurementTrack: "warehouse_stock", sentToPurchasingAt: null, shipTo: null }],
      }),
    });
    const saved = await saveProjectSites([makeSite({ bom: [{ item: "Widget", qty: 2, status: "Not started", requestSpeed: "Standard" }] })], "token");
    expect(saved[0].bom).toEqual([expect.objectContaining({ id: "line-1", sku: "SKU-1" })]);
  });

  it("throws a plain message and logs detail when the RPC fails outright", async () => {
    installFetchRouter({
      projects: respond(true, 200, [{ id: "proj-1", project_name: "Test Project" }]),
      scope: respond(true, 200, [{ project_id: "proj-1" }]),
      bomRpc: respond(false, 400, { message: "these item names match more than one catalog item", code: "EC024" }),
    });
    await expect(
      saveProjectSites([makeSite({ bom: [{ item: "Ambiguous Item", qty: 1, status: "Not started", requestSpeed: "Standard" }] })], "token"),
    ).rejects.toThrow("Some project BOM changes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('replace_project_bom_lines RPC failed for "Test Project" (400)'),
      expect.objectContaining({ code: "EC024" }),
    );
  });
});

// Updated 2026-09-12 (overnight reliability closeout part 2, task 3):
// restoreFullBackupSnapshot no longer rejects when a single section
// fails -- it catches each section's error and reports it in the
// returned RestoreOutcome instead, so a later, independent section can
// still be attempted (see restore-backup-snapshot.test.ts for the
// orchestrator-level tests). These two tests now confirm the same
// underlying failures surface as a failed section with the same plain
// message, instead of a thrown rejection.
describe("a write-verification failure reaches restoreFullBackupSnapshot's returned outcome, not just the function under test", () => {
  it("reports a saveInventoryItems balance-write failure as a failed inventoryItems section", async () => {
    installFetchRouter({
      items: respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]),
      balances: respond(true, 200, []),
    });
    const outcome = await restoreFullBackupSnapshot({ inventoryItems: [makePart()] }, "token");
    expect(outcome.ok).toBe(false);
    expect(outcome.sections.find((s) => s.section === "inventoryItems")).toMatchObject({
      attempted: true,
      succeeded: false,
      error: "Some inventory quantities could not be saved.",
    });
  });

  it("reports a saveProjectSites scope-of-work failure as a failed projectSites section", async () => {
    installFetchRouter({
      projects: respond(true, 200, [{ id: "proj-1", project_name: "Test Project" }]),
      scope: respond(true, 200, []),
    });
    const outcome = await restoreFullBackupSnapshot({ projectSites: [makeSite()] }, "token");
    expect(outcome.ok).toBe(false);
    expect(outcome.sections.find((s) => s.section === "projectSites")).toMatchObject({
      attempted: true,
      succeeded: false,
      error: "Some project details could not be saved.",
    });
  });
});
