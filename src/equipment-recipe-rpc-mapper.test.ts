import { describe, it, expect } from "vitest";
import { mapSaveEquipmentRecipeResult, type SaveEquipmentRecipeResult } from "./persistence";

// Migration 130's save_equipment_recipe() RPC is not wired into
// saveDeviceRecipes yet (a separate, later step) -- but its return shape
// cannot be assigned directly to BuildRecipe, since imageUrl comes back as
// a real JSON null (JSON has no "undefined") while BuildRecipe.imageUrl is
// `string | undefined`. mapSaveEquipmentRecipeResult is the one place that
// converts the raw RPC shape into a real BuildRecipe, preserving the same
// null-to-undefined convention mapEquipmentTypeRow already uses for the
// live load path -- these tests lock in that conversion now, ahead of the
// wiring step that will actually call the RPC.

function makeRawResult(overrides: Partial<SaveEquipmentRecipeResult> = {}): SaveEquipmentRecipeResult {
  return {
    equipmentTypeId: "et-1",
    name: "Test Recipe",
    outputName: "Test Output",
    description: "A description",
    imageUrl: "https://example.test/img.png",
    retired: false,
    components: [{ itemName: "Widget", qty: 2 }],
    ...overrides,
  };
}

describe("mapSaveEquipmentRecipeResult", () => {
  it("converts a real imageUrl string through unchanged", () => {
    const mapped = mapSaveEquipmentRecipeResult(makeRawResult({ imageUrl: "https://example.test/img.png" }));
    expect(mapped.imageUrl).toBe("https://example.test/img.png");
  });

  it("converts a null imageUrl to undefined, not null", () => {
    const mapped = mapSaveEquipmentRecipeResult(makeRawResult({ imageUrl: null }));
    expect(mapped.imageUrl).toBeUndefined();
    expect(mapped.imageUrl).not.toBeNull();
  });

  it("passes every other field through unchanged", () => {
    const raw = makeRawResult({
      equipmentTypeId: "et-42",
      name: "Recipe Name",
      outputName: "Output Name",
      description: "Some description",
      retired: true,
      components: [
        { itemName: "Item A", qty: 1 },
        { itemName: "Item B", qty: 3.5 },
      ],
    });
    const mapped = mapSaveEquipmentRecipeResult(raw);
    expect(mapped.equipmentTypeId).toBe("et-42");
    expect(mapped.name).toBe("Recipe Name");
    expect(mapped.outputName).toBe("Output Name");
    expect(mapped.description).toBe("Some description");
    expect(mapped.retired).toBe(true);
    expect(mapped.components).toEqual([
      { itemName: "Item A", qty: 1 },
      { itemName: "Item B", qty: 3.5 },
    ]);
  });

  it("produces an object assignable to BuildRecipe with an empty components array", () => {
    const mapped = mapSaveEquipmentRecipeResult(makeRawResult({ components: [] }));
    expect(mapped.components).toEqual([]);
  });
});
