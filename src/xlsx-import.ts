// D6 (approved 2026-09-16): replaces `xlsx` (SheetJS) with `exceljs` for
// this app's only two spreadsheet-import call sites (handleBomFileSelect,
// handleCatalogFileSelect in main.tsx) -- xlsx is capped at 0.18.5 on npm
// indefinitely (SheetJS's own terminal release; later fixes exist only
// via their own CDN, not a normal `npm install`), so its Prototype
// Pollution/ReDoS advisories can never clear via a version bump.
// PRODUCT_XLSX_REPLACEMENT_EVALUATION.md has the full trace/comparison;
// this is that recommendation actually built, with real parity proof --
// see xlsx-import.test.ts, which builds synthetic workbooks covering
// every edge case the evaluation doc named (blank cells, numeric-looking
// text, a header-only file) and asserts this function's output against
// what xlsx's own sheet_to_json({defval:""}) produced for the identical
// file, not a guess.
//
// Dynamically imports exceljs, matching xlsx's own existing lazy-load
// discipline (2026-09-12, Queue A-series bundle-size work) -- this is a
// large dependency used only when a user actually opens one of the two
// import flows; every other session should not pay for it on first load.
//
// First sheet only, header-row-to-JSON, blank cells become "" -- exactly
// xlsx's sheet_to_json({defval:""}) behavior, since both call sites'
// existing downstream field-matching logic depends on that shape.
export async function parseWorkbookSheetToRows(buffer: ArrayBuffer): Promise<Record<string, unknown>[]> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  // exceljs's own TypeScript types only declare `load(buffer: Buffer)`,
  // but the real runtime implementation works correctly against a plain
  // Uint8Array (empirically verified -- there is no Node-specific Buffer
  // type in this browser-only project, and none is needed at runtime
  // either, which is exactly why the cast below derives its target type
  // from exceljs's own signature instead of naming the Node-only
  // `Buffer` type directly).
  await workbook.xlsx.load(new Uint8Array(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return [];
  }

  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = cell.value != null ? String(cell.value).trim() : "";
  });

  const rows: Record<string, unknown>[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const obj: Record<string, unknown> = {};
    let hasAnyValue = false;
    for (let colNumber = 1; colNumber < headers.length; colNumber += 1) {
      const header = headers[colNumber];
      if (!header) {
        continue;
      }
      const cell = row.getCell(colNumber);
      let value: unknown = cell.value;
      // Rich text and formula cells come back as objects, not a plain
      // scalar -- unwrap to the value a caller actually wants, matching
      // what a plain xlsx-parsed cell would have given.
      if (value && typeof value === "object" && "text" in value) {
        value = (value as { text: unknown }).text;
      } else if (value && typeof value === "object" && "result" in value) {
        value = (value as { result: unknown }).result;
      }
      if (value === null || value === undefined) {
        obj[header] = "";
      } else {
        obj[header] = value;
        hasAnyValue = true;
      }
    }
    // A fully-blank row (every mapped column empty) is not a real data
    // row -- xlsx's own sheet_to_json never produces one either, since it
    // derives rows from cells that actually exist.
    if (hasAnyValue) {
      rows.push(obj);
    }
  }
  return rows;
}
