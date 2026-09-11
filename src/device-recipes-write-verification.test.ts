import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveDeviceRecipes, restoreFullBackupSnapshot, type BuildRecipe } from "./persistence";

// PRODUCT_ERROR_VISIBILITY_AUDIT.md Addendum 2's saveDeviceRecipes finding
// (2026-09-11 overnight local-only pass, task 3): every fetch in this
// function was either completely unchecked (the two upfront lookups
// degraded to an empty map on failure -- which, given equipment_name has a
// real unique index (migration 020), meant an existing recipe would be
// silently dropped rather than saved if the equipment_types lookup failed,
// not duplicated) or checked-but-swallowed (an existing recipe's PATCH
// result was discarded outright; a new recipe's failed INSERT just
// `continue`d to the next recipe with no record of which one or how many;
// both component-line writes were fire-and-forget). None of this could
// ever throw, so saveDeviceRecipes' own caller in main.tsx (whose .catch
// sets a visible status) and restoreFullBackupSnapshot (which awaits this
// function directly, no try/catch of its own) both had no way to learn a
// save had partially or fully failed.
//
// These tests lock in the fix: every step now checks .ok, checks a row
// count where PostgREST can report one (`return=representation`), and
// throws immediately on the first failure -- stopping at the first failing
// recipe rather than silently skip-and-continue, since "N of M saved,
// silently" is the same failure shape being fixed, not a softer version of
// it. Real status/body/count/recipe-name detail is logged via
// console.error; the caller only ever sees a plain message ("Some
// equipment recipes could not be saved.").
//
// Correction, 2026-09-11 (same day, review found a real remaining gap):
// the HTTP/row checks above did not cover a silent-loss path in the
// component-name resolution step. A component name that failed to
// resolve to exactly one inventory_items row (renamed/deleted item, or a
// duplicate item_name in the catalog) was silently filtered out of BOTH
// componentPayload (never written) AND desiredComponentIds (the "keep"
// set) -- so the cleanup step further down would then DELETE that
// component's existing row, since it no longer appeared "wanted," with
// nothing written to replace it. Fixed with a preflight that checks every
// component name across every recipe BEFORE any write happens; zero or
// more-than-one matches reject the entire save (all recipes, not just the
// affected one) with no write attempted at all. outputName resolution is
// deliberately untouched by this preflight -- it already tolerates
// resolving to null and that existing behavior is not being changed here.

function respond(ok: boolean, status: number, body: unknown) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function makeRecipe(overrides: Partial<BuildRecipe> = {}): BuildRecipe {
  return {
    name: "Enterprise VPU Server",
    outputName: "Enterprise VPU Server",
    description: "",
    components: [{ itemName: "Widget", qty: 2 }],
    ...overrides,
  };
}

type Routes = {
  itemsLookup?: ReturnType<typeof respond>;
  equipmentLookup?: ReturnType<typeof respond>;
  update?: ReturnType<typeof respond>;
  insert?: ReturnType<typeof respond>;
  componentUpsert?: ReturnType<typeof respond>;
  componentLookup?: ReturnType<typeof respond>;
  componentDelete?: ReturnType<typeof respond>;
};

// Method-aware, not call-order-aware -- saveDeviceRecipes loops per recipe
// and each recipe issues up to 4 requests against overlapping URL prefixes
// (equipment_types PATCH vs POST, equipment_bom_components POST vs GET vs
// DELETE), so routing on HTTP method is what actually distinguishes them,
// not substring position.
function installFetchRouter(routes: Routes) {
  const mock = vi.fn().mockImplementation(async (input, init?: { method?: string }) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/inventory_items?select=")) {
      return routes.itemsLookup ?? respond(true, 200, [{ id: "item-1", item_name: "Widget" }]);
    }
    if (url.includes("/equipment_types")) {
      if (method === "PATCH") return routes.update ?? respond(true, 200, [{ id: "eq-1" }]);
      if (method === "POST") return routes.insert ?? respond(true, 200, [{ id: "eq-1" }]);
      return routes.equipmentLookup ?? respond(true, 200, []);
    }
    if (url.includes("/equipment_bom_components")) {
      if (method === "POST") return routes.componentUpsert ?? respond(true, 200, [{ inventory_item_id: "item-1" }]);
      if (method === "DELETE") return routes.componentDelete ?? respond(true, 200, []);
      return routes.componentLookup ?? respond(true, 200, []);
    }
    throw new Error(`Unmocked fetch call in test: ${method} ${url}`);
  });
  globalThis.fetch = mock;
  return mock;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveDeviceRecipes -- upfront lookup verification", () => {
  it("throws and logs when the inventory_items lookup fails", async () => {
    installFetchRouter({ itemsLookup: respond(false, 500, { message: "db down" }) });
    await expect(saveDeviceRecipes([makeRecipe()], "token")).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("inventory_items lookup failed (500)"));
  });

  it("throws and logs when the equipment_types lookup fails -- prevents every existing recipe from being silently dropped", async () => {
    installFetchRouter({ equipmentLookup: respond(false, 503, { message: "db down" }) });
    await expect(saveDeviceRecipes([makeRecipe()], "token")).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("equipment_types lookup failed (503)"));
  });
});

describe("saveDeviceRecipes -- existing recipe update verification", () => {
  it("throws and logs when the equipment_types PATCH fails outright", async () => {
    installFetchRouter({
      equipmentLookup: respond(true, 200, [{ id: "eq-1", equipment_name: "Enterprise VPU Server" }]),
      update: respond(false, 500, { message: "constraint violation" }),
    });
    await expect(saveDeviceRecipes([makeRecipe()], "token")).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('equipment_types update failed for "Enterprise VPU Server" (500)'));
  });

  it("throws and logs when the equipment_types PATCH returns 200 OK but affects zero rows (RLS block)", async () => {
    installFetchRouter({
      equipmentLookup: respond(true, 200, [{ id: "eq-1", equipment_name: "Enterprise VPU Server" }]),
      update: respond(true, 200, []),
    });
    await expect(saveDeviceRecipes([makeRecipe()], "token")).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("affected 0 rows"));
  });
});

describe("saveDeviceRecipes -- new recipe insert verification", () => {
  it("throws and logs the recipe name when the equipment_types insert fails, instead of silently continuing", async () => {
    installFetchRouter({
      insert: respond(false, 409, { message: "duplicate key" }),
    });
    await expect(saveDeviceRecipes([makeRecipe({ name: "New Recipe" })], "token")).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('equipment_types insert failed for "New Recipe" (409)'));
  });

  it("throws when the insert returns 200 OK but no row (no id to attach components to)", async () => {
    installFetchRouter({ insert: respond(true, 200, []) });
    await expect(saveDeviceRecipes([makeRecipe({ name: "New Recipe" })], "token")).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('insert for "New Recipe" returned no row'));
  });
});

describe("saveDeviceRecipes -- BOM component line verification", () => {
  it("throws and logs when the component upsert fails outright", async () => {
    installFetchRouter({
      equipmentLookup: respond(true, 200, [{ id: "eq-1", equipment_name: "Enterprise VPU Server" }]),
      componentUpsert: respond(false, 500, { message: "constraint violation" }),
    });
    await expect(saveDeviceRecipes([makeRecipe()], "token")).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("equipment_bom_components write failed"));
  });

  it("throws when the component upsert returns fewer rows than sent", async () => {
    installFetchRouter({
      equipmentLookup: respond(true, 200, [{ id: "eq-1", equipment_name: "Enterprise VPU Server" }]),
      componentUpsert: respond(true, 200, []),
    });
    await expect(
      saveDeviceRecipes([makeRecipe({ components: [{ itemName: "Widget", qty: 1 }] })], "token"),
    ).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("returned 0 row(s), expected 1"));
  });

  it("throws and logs when the existing-components lookup fails", async () => {
    installFetchRouter({
      equipmentLookup: respond(true, 200, [{ id: "eq-1", equipment_name: "Enterprise VPU Server" }]),
      componentLookup: respond(false, 500, { message: "db down" }),
    });
    await expect(saveDeviceRecipes([makeRecipe()], "token")).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("equipment_bom_components lookup failed"));
  });

  it("throws when a stale component's delete fails outright", async () => {
    installFetchRouter({
      equipmentLookup: respond(true, 200, [{ id: "eq-1", equipment_name: "Enterprise VPU Server" }]),
      // "old-item" is not in the recipe's current component list, so it's
      // a candidate for removal.
      componentLookup: respond(true, 200, [{ inventory_item_id: "old-item" }]),
      componentDelete: respond(false, 500, { message: "constraint violation" }),
    });
    await expect(saveDeviceRecipes([makeRecipe()], "token")).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("equipment_bom_components delete failed"));
  });

  it("throws when the delete returns fewer removed rows than expected", async () => {
    installFetchRouter({
      equipmentLookup: respond(true, 200, [{ id: "eq-1", equipment_name: "Enterprise VPU Server" }]),
      componentLookup: respond(true, 200, [{ inventory_item_id: "old-item" }]),
      componentDelete: respond(true, 200, []),
    });
    await expect(saveDeviceRecipes([makeRecipe()], "token")).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("removed 0 row(s), expected 1"));
  });
});

describe("saveDeviceRecipes -- component-name resolution preflight (rejects before any write)", () => {
  it("an unresolved component name prevents every write -- no equipment_types or equipment_bom_components call happens", async () => {
    const fetchMock = installFetchRouter({
      // "Widget" (the component makeRecipe() uses) does not appear at all.
      itemsLookup: respond(true, 200, []),
    });
    await expect(saveDeviceRecipes([makeRecipe()], "token")).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('unresolved component name(s): [Enterprise VPU Server -> "Widget"]'),
    );
    // Only the upfront inventory_items lookup ran -- equipment_types
    // (lookup/PATCH/POST) and equipment_bom_components (upsert/lookup/
    // delete) were never called at all.
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("a duplicated inventory item name prevents every write -- no equipment_types or equipment_bom_components call happens", async () => {
    const fetchMock = installFetchRouter({
      // Two catalog rows both named "Widget" -- genuinely ambiguous.
      itemsLookup: respond(true, 200, [
        { id: "item-1", item_name: "Widget" },
        { id: "item-2", item_name: "Widget" },
      ]),
    });
    await expect(saveDeviceRecipes([makeRecipe()], "token")).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('ambiguous (duplicate catalog match) component name(s): [Enterprise VPU Server -> "Widget" (2 catalog matches)]'),
    );
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("rejects the whole save (a second, otherwise-fine recipe is not written either) when one recipe has an unresolved component", async () => {
    const fetchMock = installFetchRouter({ itemsLookup: respond(true, 200, [{ id: "item-1", item_name: "Known Part" }]) });
    await expect(
      saveDeviceRecipes(
        [
          makeRecipe({ name: "Bad Recipe", components: [{ itemName: "Missing Part", qty: 1 }] }),
          makeRecipe({ name: "Fine Recipe", outputName: "Fine Recipe", components: [{ itemName: "Known Part", qty: 1 }] }),
        ],
        "token",
      ),
    ).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("a recipe with no components still saves correctly -- the preflight has nothing to check and does not block it", async () => {
    installFetchRouter({
      itemsLookup: respond(true, 200, []),
      equipmentLookup: respond(true, 200, [{ id: "eq-1", equipment_name: "Enterprise VPU Server" }]),
      componentLookup: respond(true, 200, []),
    });
    await expect(saveDeviceRecipes([makeRecipe({ components: [] })], "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("outputName behavior is unchanged: an unresolved outputName does not reject the save (only components are preflighted)", async () => {
    installFetchRouter({
      // "Widget" (the only component) resolves; "Enterprise VPU Server"
      // (the outputName, same as recipe.name here) does not appear in the
      // lookup at all -- output_inventory_item_id ends up null, same as
      // before this fix, and that's not being changed.
      itemsLookup: respond(true, 200, [{ id: "item-1", item_name: "Widget" }]),
      equipmentLookup: respond(true, 200, [{ id: "eq-1", equipment_name: "Enterprise VPU Server" }]),
      componentLookup: respond(true, 200, []),
    });
    await expect(saveDeviceRecipes([makeRecipe()], "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("saveDeviceRecipes -- duplicate-component-within-one-recipe preflight (rejects before any write)", () => {
  // Reviewed 2026-09-11 (same day, second correction): the unresolved/
  // ambiguous-name preflight above does not catch the same catalog item
  // appearing twice in one recipe's own component list -- that would
  // produce duplicate (equipment_type_id, inventory_item_id) rows in the
  // same bulk equipment_bom_components upsert, which Postgres can reject
  // as a real constraint violation *after* that recipe's equipment_types
  // write has already committed.

  it("the same component name listed twice in one recipe rejects the whole save -- no write occurs", async () => {
    const fetchMock = installFetchRouter({ itemsLookup: respond(true, 200, [{ id: "item-1", item_name: "Widget" }]) });
    await expect(
      saveDeviceRecipes(
        [
          makeRecipe({
            components: [
              { itemName: "Widget", qty: 1 },
              { itemName: "Widget", qty: 2 },
            ],
          }),
        ],
        "token",
      ),
    ).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('duplicate component(s) within a single recipe: [Enterprise VPU Server -> "Widget" (listed more than once)]'),
    );
    // Only the upfront inventory_items lookup ran.
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("two different component names that resolve to the same catalog item reject the whole save -- no write occurs", async () => {
    const fetchMock = installFetchRouter({
      itemsLookup: respond(true, 200, [
        { id: "item-1", item_name: "Widget" },
        { id: "item-1", item_name: "Widget (Legacy Name)" },
      ]),
    });
    await expect(
      saveDeviceRecipes(
        [
          makeRecipe({
            components: [
              { itemName: "Widget", qty: 1 },
              { itemName: "Widget (Legacy Name)", qty: 1 },
            ],
          }),
        ],
        "token",
      ),
    ).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('duplicate component(s) within a single recipe: [Enterprise VPU Server -> "Widget" and "Widget (Legacy Name)" resolve to the same catalog item]'),
    );
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("a duplicate in one recipe does not falsely implicate, or block saving alongside, a second recipe that only shares the same component once", async () => {
    const fetchMock = installFetchRouter({ itemsLookup: respond(true, 200, [{ id: "item-1", item_name: "Widget" }]) });
    await expect(
      saveDeviceRecipes(
        [
          makeRecipe({
            name: "Duplicate Recipe",
            components: [
              { itemName: "Widget", qty: 1 },
              { itemName: "Widget", qty: 1 },
            ],
          }),
          // Uses "Widget" too, but only once -- legitimately sharing a
          // component across recipes is normal and must not be flagged.
          makeRecipe({ name: "Fine Recipe", outputName: "Fine Recipe", components: [{ itemName: "Widget", qty: 1 }] }),
        ],
        "token",
      ),
    ).rejects.toThrow("Some equipment recipes could not be saved.");
    const loggedMessage = vi.mocked(console.error).mock.calls[0][0] as string;
    expect(loggedMessage).toContain("Duplicate Recipe");
    expect(loggedMessage).not.toContain("Fine Recipe");
    // The whole save is still rejected (per the "reject before any write"
    // rule) -- Fine Recipe is not silently saved on its own either.
    expect(fetchMock.mock.calls).toHaveLength(1);
  });
});

describe("saveDeviceRecipes -- success path", () => {
  it("does not throw or log when every step succeeds, for both an existing recipe and a new one", async () => {
    installFetchRouter({
      equipmentLookup: respond(true, 200, [{ id: "eq-1", equipment_name: "Existing Recipe" }]),
    });
    await expect(
      saveDeviceRecipes(
        [makeRecipe({ name: "Existing Recipe" }), makeRecipe({ name: "New Recipe", outputName: "New Recipe" })],
        "token",
      ),
    ).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("a thrown saveDeviceRecipes error reaches restoreFullBackupSnapshot, not just the function under test", () => {
  it("propagates a component-write failure out of restoreFullBackupSnapshot", async () => {
    installFetchRouter({
      equipmentLookup: respond(true, 200, [{ id: "eq-1", equipment_name: "Enterprise VPU Server" }]),
      componentUpsert: respond(true, 200, []),
    });
    await expect(restoreFullBackupSnapshot({ deviceRecipes: [makeRecipe()] }, "token")).rejects.toThrow(
      "Some equipment recipes could not be saved.",
    );
  });
});
