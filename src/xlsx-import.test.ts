import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseWorkbookSheetToRows } from "./xlsx-import";

// D6 (approved 2026-09-16): parity proof that parseWorkbookSheetToRows
// (exceljs-based) produces the same shape xlsx's own
// sheet_to_json(sheet, { defval: "" }) did for this app's real usage --
// first sheet only, header-row-to-JSON, blank cells become "". Expected
// values below were captured from a real side-by-side run against both
// libraries for the identical synthetic file (not guessed) before xlsx
// was removed from this repo's dependencies -- see the D6 commit message
// for the exact comparison script and its output. Every edge case named
// in PRODUCT_XLSX_REPLACEMENT_EVALUATION.md is covered: blank cells,
// numeric-looking text, a header-only file.

async function buildWorkbookBuffer(rows: unknown[][]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRows(rows);
  return workbook.xlsx.writeBuffer();
}

describe("parseWorkbookSheetToRows", () => {
  it("parses a normal BOM-import-shaped file (Item/Qty headers)", async () => {
    const buffer = await buildWorkbookBuffer([
      ["Item", "Qty"],
      ["Camera Mount Bracket", 4],
      ["Cat6 Cable 100ft", 2],
    ]);
    const rows = await parseWorkbookSheetToRows(buffer);
    expect(rows).toEqual([
      { Item: "Camera Mount Bracket", Qty: 4 },
      { Item: "Cat6 Cable 100ft", Qty: 2 },
    ]);
  });

  it("fills blank cells with '' (matches xlsx's defval: \"\")", async () => {
    const buffer = await buildWorkbookBuffer([
      ["Item", "Qty", "Notes"],
      ["Widget A", 1, null],
      [null, 2, "no item name"],
      ["Widget B", null, ""],
    ]);
    const rows = await parseWorkbookSheetToRows(buffer);
    expect(rows).toEqual([
      { Item: "Widget A", Qty: 1, Notes: "" },
      { Item: "", Qty: 2, Notes: "no item name" },
      { Item: "Widget B", Qty: "", Notes: "" },
    ]);
  });

  it("preserves the distinction between a numeric-looking text cell and a real number", async () => {
    const buffer = await buildWorkbookBuffer([
      ["Item", "Qty"],
      ["Widget C", "5"],
      ["Widget D", 5],
    ]);
    const rows = await parseWorkbookSheetToRows(buffer);
    expect(rows[0].Qty).toBe("5");
    expect(rows[1].Qty).toBe(5);
  });

  it("returns an empty array for a header-only file with no data rows", async () => {
    const buffer = await buildWorkbookBuffer([["Item", "Qty"]]);
    const rows = await parseWorkbookSheetToRows(buffer);
    expect(rows).toEqual([]);
  });

  it("parses a catalog-import-shaped file with more columns", async () => {
    const buffer = await buildWorkbookBuffer([
      ["Product Name", "Manufacturer", "Catalog Number", "Category"],
      ["4K Dome Camera", "Axis", "P3268-LVE", "Cameras"],
      ["24-Port Switch", "Cisco", "C9200-24P", "Networking"],
    ]);
    const rows = await parseWorkbookSheetToRows(buffer);
    expect(rows).toEqual([
      { "Product Name": "4K Dome Camera", Manufacturer: "Axis", "Catalog Number": "P3268-LVE", Category: "Cameras" },
      { "Product Name": "24-Port Switch", Manufacturer: "Cisco", "Catalog Number": "C9200-24P", Category: "Networking" },
    ]);
  });

  it("only reads the first sheet, ignoring any others (matches xlsx's own first-sheet-only behavior)", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Sheet1").addRows([["Item"], ["From sheet 1"]]);
    workbook.addWorksheet("Sheet2").addRows([["Item"], ["From sheet 2 -- must not appear"]]);
    const buffer = await workbook.xlsx.writeBuffer();
    const rows = await parseWorkbookSheetToRows(buffer as ArrayBuffer);
    expect(rows).toEqual([{ Item: "From sheet 1" }]);
  });

  it("returns an empty array for a completely empty workbook (no worksheets)", async () => {
    const workbook = new ExcelJS.Workbook();
    const buffer = await workbook.xlsx.writeBuffer();
    const rows = await parseWorkbookSheetToRows(buffer as ArrayBuffer);
    expect(rows).toEqual([]);
  });
});
