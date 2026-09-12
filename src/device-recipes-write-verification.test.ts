import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveDeviceRecipes, restoreFullBackupSnapshot, type BuildRecipe } from "./persistence";

// Migration 130 moved saveDeviceRecipes from several separate,
// independently-committing PostgREST requests per recipe (an
// equipment_types PATCH/INSERT, a bulk BOM upsert, a BOM cleanup DELETE,
// plus two upfront preflight lookups) to one atomic, per-recipe RPC call
// (rpc/save_equipment_recipe) -- component-name resolution, the
// equipment_types upsert, and BOM reconciliation all happen inside a
// single Postgres transaction per recipe now. These tests replace the
// old multi-request-mock suite (which tested request sequencing that no
// longer exists) and instead lock in: one RPC call per recipe, sending
// equipmentTypeId for an existing recipe and null for a new one, mapping
// the RPC's response through mapSaveEquipmentRecipeResult, stopping at
// the first failing recipe (not skip-and-continue), and surfacing only a
// plain message to the caller while logging the real status/body via
// console.error.

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
    clientId: "client-enterprise-vpu-server",
    name: "Enterprise VPU Server",
    outputName: "Enterprise VPU Server",
    description: "",
    components: [{ itemName: "Widget", qty: 2 }],
    ...overrides,
  };
}

function makeRpcResult(overrides: Partial<{
  equipmentTypeId: string;
  name: string;
  outputName: string;
  description: string;
  imageUrl: string | null;
  retired: boolean;
  components: Array<{ itemName: string; qty: number }>;
}> = {}) {
  return {
    equipmentTypeId: "eq-1",
    name: "Enterprise VPU Server",
    outputName: "Enterprise VPU Server",
    description: "",
    imageUrl: null,
    retired: false,
    components: [{ itemName: "Widget", qty: 2 }],
    ...overrides,
  };
}

// Routes by call index -- saveDeviceRecipes issues exactly one
// rpc/save_equipment_recipe POST per recipe, in order, so a queue of
// per-call responses is enough to control each recipe's outcome
// independently without needing to parse the request body to tell them
// apart.
function installFetchRouter(responses: Array<ReturnType<typeof respond>>) {
  let callIndex = 0;
  const calls: Array<{ url: string; body: unknown }> = [];
  const mock = vi.fn().mockImplementation(async (input, init?: { method?: string; body?: string }) => {
    const url = String(input);
    if (!url.includes("/rpc/save_equipment_recipe")) {
      throw new Error(`Unmocked fetch call in test: ${init?.method ?? "GET"} ${url}`);
    }
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    const response = responses[callIndex];
    callIndex += 1;
    if (!response) {
      throw new Error(`No mock response queued for call ${callIndex}`);
    }
    return response;
  });
  globalThis.fetch = mock;
  return { mock, calls };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveDeviceRecipes -- new recipe save", () => {
  it("sends p_equipment_type_id: null for a recipe with no equipmentTypeId yet, and returns the id the RPC created", async () => {
    const { calls } = installFetchRouter([respond(true, 200, makeRpcResult({ equipmentTypeId: "new-eq-1", name: "New Recipe", outputName: "New Recipe" }))]);
    const saved = await saveDeviceRecipes([makeRecipe({ name: "New Recipe", outputName: "New Recipe" })], "token");
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ p_equipment_type_id: null, p_equipment_name: "New Recipe" });
    expect(saved).toEqual([expect.objectContaining({ equipmentTypeId: "new-eq-1", name: "New Recipe" })]);
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("saveDeviceRecipes -- existing recipe save", () => {
  it("sends the recipe's real equipmentTypeId as p_equipment_type_id", async () => {
    const { calls } = installFetchRouter([respond(true, 200, makeRpcResult({ equipmentTypeId: "eq-1" }))]);
    await saveDeviceRecipes([makeRecipe({ equipmentTypeId: "eq-1" })], "token");
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ p_equipment_type_id: "eq-1", p_equipment_name: "Enterprise VPU Server" });
  });
});

describe("saveDeviceRecipes -- renamed recipe save", () => {
  it("sends the new name alongside the existing equipmentTypeId, so the RPC updates that row instead of resolving (and potentially duplicating) by name", async () => {
    const { calls } = installFetchRouter([respond(true, 200, makeRpcResult({ equipmentTypeId: "eq-1", name: "Renamed Server" }))]);
    const saved = await saveDeviceRecipes([makeRecipe({ equipmentTypeId: "eq-1", name: "Renamed Server" })], "token");
    expect(calls[0].body).toMatchObject({ p_equipment_type_id: "eq-1", p_equipment_name: "Renamed Server" });
    expect(saved[0].name).toBe("Renamed Server");
    expect(saved[0].equipmentTypeId).toBe("eq-1");
  });
});

describe("saveDeviceRecipes -- failed save", () => {
  it("throws a plain message and logs the real status/body when the RPC responds with a non-2xx status", async () => {
    installFetchRouter([respond(false, 400, { message: "Every component must have a quantity greater than zero.", code: "EC011" })]);
    await expect(saveDeviceRecipes([makeRecipe()], "token")).rejects.toThrow("Some equipment recipes could not be saved.");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('save_equipment_recipe RPC failed for "Enterprise VPU Server" (400)'),
      expect.objectContaining({ code: "EC011" }),
    );
  });
});

describe("saveDeviceRecipes -- multiple-recipe save", () => {
  it("calls the RPC once per recipe, in order, and returns every mapped result when all succeed", async () => {
    const { calls } = installFetchRouter([
      respond(true, 200, makeRpcResult({ equipmentTypeId: "eq-1", name: "Recipe One", outputName: "Recipe One" })),
      respond(true, 200, makeRpcResult({ equipmentTypeId: "eq-2", name: "Recipe Two", outputName: "Recipe Two" })),
    ]);
    const saved = await saveDeviceRecipes(
      [
        makeRecipe({ equipmentTypeId: "eq-1", name: "Recipe One", outputName: "Recipe One" }),
        makeRecipe({ name: "Recipe Two", outputName: "Recipe Two" }),
      ],
      "token",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toMatchObject({ p_equipment_type_id: "eq-1" });
    expect(calls[1].body).toMatchObject({ p_equipment_type_id: null });
    expect(saved.map((recipe) => recipe.name)).toEqual(["Recipe One", "Recipe Two"]);
  });

  it("stops at the first failing recipe -- a later, otherwise-fine recipe is never sent (no skip-and-continue)", async () => {
    const { calls } = installFetchRouter([
      respond(false, 500, { message: "db error" }),
      respond(true, 200, makeRpcResult({ name: "Recipe Two" })),
    ]);
    await expect(
      saveDeviceRecipes(
        [makeRecipe({ name: "Recipe One", outputName: "Recipe One" }), makeRecipe({ name: "Recipe Two", outputName: "Recipe Two" })],
        "token",
      ),
    ).rejects.toThrow("Some equipment recipes could not be saved.");
    // Only the first recipe's RPC call happened -- the second was never sent.
    expect(calls).toHaveLength(1);
  });
});

describe("saveDeviceRecipes -- component payload shape", () => {
  it("sends components as {item_name, quantity_required, line_sort} in display order", async () => {
    const { calls } = installFetchRouter([respond(true, 200, makeRpcResult())]);
    await saveDeviceRecipes(
      [
        makeRecipe({
          components: [
            { itemName: "Widget", qty: 2 },
            { itemName: "Gadget", qty: 1 },
          ],
        }),
      ],
      "token",
    );
    expect(calls[0].body).toMatchObject({
      p_components: [
        { item_name: "Widget", quantity_required: 2, line_sort: 0 },
        { item_name: "Gadget", quantity_required: 1, line_sort: 1 },
      ],
    });
  });
});

describe("a thrown saveDeviceRecipes error reaches restoreFullBackupSnapshot, not just the function under test", () => {
  it("propagates an RPC failure out of restoreFullBackupSnapshot", async () => {
    installFetchRouter([respond(false, 500, { message: "db error" })]);
    await expect(restoreFullBackupSnapshot({ deviceRecipes: [makeRecipe()] }, "token")).rejects.toThrow(
      "Some equipment recipes could not be saved.",
    );
  });
});
