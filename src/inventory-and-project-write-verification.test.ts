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
// Deliberately NOT covered here: saveProjectSites' BOM delete-then-
// reinsert. See its own "NOT COVERED" comment in persistence.ts -- a
// row-count check there could only detect the INSERT failing, it could
// never undo the DELETE that already ran, so it isn't a real fix and
// isn't tested as if it were one. See PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md
// for the separate, not-yet-implemented design for that.

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
  bomLookup?: ReturnType<typeof respond>;
  bomDelete?: ReturnType<typeof respond>;
  bomInsert?: ReturnType<typeof respond>;
}) {
  const mock = vi.fn().mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/inventory_items?on_conflict=sku")) {
      return routes.items ?? respond(true, 200, []);
    }
    if (url.includes("/inventory_items?select=")) {
      return routes.bomLookup ?? respond(true, 200, []);
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
    if (url.includes("/project_bom_lines?project_id=in.")) {
      return routes.bomDelete ?? respond(true, 200, []);
    }
    if (url.includes("/project_bom_lines")) {
      return routes.bomInsert ?? respond(true, 200, []);
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
      bomDelete: respond(true, 200, []),
    });
    await expect(saveProjectSites([makeSite()], "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("a thrown write-verification error reaches a real caller, not just the function under test", () => {
  // restoreFullBackupSnapshot awaits saveInventoryItems/saveProjectSites
  // directly with no try/catch of its own -- this is the actual caller
  // main.tsx's importBackup relies on to know a restore partially failed.
  // Before this fix, neither underlying write ever threw for this failure
  // shape, so restoreFullBackupSnapshot resolved normally and importBackup
  // showed "Backup restored." even though stock levels or scope-of-work
  // text silently didn't persist. Proving the rejection reaches this real
  // caller is what proves that false-success path is now closed.
  it("propagates a saveInventoryItems balance-write failure out of restoreFullBackupSnapshot", async () => {
    installFetchRouter({
      items: respond(true, 200, [{ id: "item-1", sku: "SKU-1" }]),
      balances: respond(true, 200, []),
    });
    await expect(restoreFullBackupSnapshot({ inventoryItems: [makePart()] }, "token")).rejects.toThrow(
      "Some inventory quantities could not be saved.",
    );
  });

  it("propagates a saveProjectSites scope-of-work failure out of restoreFullBackupSnapshot", async () => {
    installFetchRouter({
      projects: respond(true, 200, [{ id: "proj-1", project_name: "Test Project" }]),
      scope: respond(true, 200, []),
    });
    await expect(restoreFullBackupSnapshot({ projectSites: [makeSite()] }, "token")).rejects.toThrow(
      "Some project details could not be saved.",
    );
  });
});
