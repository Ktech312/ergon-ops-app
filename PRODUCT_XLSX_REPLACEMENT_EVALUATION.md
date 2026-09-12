# xlsx Dependency — Replacement Evaluation

Status: **READ-ONLY EVALUATION. NO DECISION MADE. NOTHING INSTALLED, REMOVED, OR UPGRADED.** Written per the 2026-09-12 overnight reliability closeout. Supersedes the "three-option, undecided" framing previously referenced from `PRODUCT_ACCESSIBILITY_MOBILE_PERF_AUDIT.md` Part F and `HANDOFF.md`'s 2026-09-11 entry with a concrete recommendation — still a recommendation, not a decision; E has not chosen an option.

## 1. Current usage — exhaustive

`xlsx` (SheetJS), pinned `^0.18.5`, resolved `0.18.5` in `package.json`. This is the last version SheetJS ever published to the public npm registry — later fixes exist only via SheetJS's own CDN (`cdn.sheetjs.com`), not installable through a normal `npm install` from a lockfile-tracked registry, which is exactly why this keeps surfacing in `npm audit`/Dependabot with no in-place fix available.

Exactly two call sites in the entire repository (confirmed by an exhaustive `grep` across `src/` and `api/`, and repo-wide for any other `xlsx`/`exceljs` reference):

1. **`handleBomFileSelect`** (`src/main.tsx:11903`, "Phase 19" BOM spreadsheet import) — `XLSX.read(buffer, { type: "array" })` then `XLSX.utils.sheet_to_json(sheet, { defval: "" })` on `workbook.Sheets[workbook.SheetNames[0]]` (first sheet only), loosely matching header columns (item/model/hardware/name, qty/quantity) into `{ item, qty }` rows for preview before commit.
2. **`handleCatalogFileSelect`** (`src/main.tsx:18693`, bulk product-catalog import) — identical pattern, matching ~18 candidate header names into a `CatalogItem` draft.

Both run **entirely client-side** (a React event handler on `<input type="file">`, parsed via `FileReader`/`arrayBuffer()` in-browser) — zero server involvement, confirmed by grepping the entire `api/` directory for any xlsx/exceljs/excel reference (zero matches).

**Not used anywhere**: `XLSX.writeFile`, `XLSX.utils.json_to_sheet`, `XLSX.utils.book_new`, any cell styling/formatting API, formula read or write, multi-sheet handling (both sites hard-code the first sheet only). Every export feature in this app (CSV downloads) is hand-rolled `Blob`/CSV generation with no xlsx dependency at all — nothing in this codebase writes `.xlsx` files today.

**Known vulnerability class** (from training knowledge — no live CVE lookup was performed in this pass): `xlsx` at this version line has published Prototype Pollution and ReDoS advisories, both triggered by parsing a maliciously crafted spreadsheet — directly relevant here since both call sites parse user-uploaded files.

## 2. Alternatives compared

The real, narrow usage pattern — **read-only, single-sheet, header-row-to-JSON, browser-only, no formulas, no styling, no writing** — is what the comparison should actually optimize for, not a generic "full Excel library" feature checklist.

| | **xlsx (current)** | **exceljs** | **read-excel-file** |
|---|---|---|---|
| Reads .xlsx | Yes (in use) | Yes | Yes |
| Writes .xlsx | Yes, unused here | Yes | **No** |
| Browser bundle, no Node polyfills | Yes (proven working) | Mostly yes (verify with a build spike before committing) | Yes, built for the browser |
| Formatting/formulas | Supported, unused here either way | Supported | N/A (read-only, computed values only) |
| Approx. bundle size (min+gzip) | ~400-500KB | ~250-300KB | ~15-20KB |
| License | Apache-2.0 | MIT | MIT |
| Security-maintenance posture | **Stalled on npm** (0.18.5 is terminal; the audit flag never clears via `npm install`) | Actively maintained, normal npm releases | Actively maintained, small parsing surface |
| Migration effort for this app's actual usage | n/a (baseline) | Low-to-moderate: no direct `sheet_to_json` equivalent — load the workbook, walk `worksheet.eachRow`, zip against the header row into the same `Record<string, unknown>[]` shape both call sites already expect (~10-15 lines per call site); everything downstream (the loose header-matching logic) is untouched | Lowest effort for the read path, similar adapter needed, but leaves no forward path if a future export-to-Excel feature is ever wanted |

Other options considered and set aside: `xlsx-populate` (write-capable but effectively unmaintained), a WASM-based reader (niche, adds Vite build-tooling complexity unjustified by two simple `sheet_to_json` calls), `node-xlsx` (a wrapper around SheetJS itself — inherits the same vulnerability, solves nothing).

## 3. Recommendation

**Migrate to `exceljs`.** Rationale specific to this app:

- The audit-tooling problem doesn't self-resolve: `xlsx` is capped at 0.18.5 on npm indefinitely, so it keeps showing up in every future scan regardless of whether the two read-only call sites are ever actually exploited. `exceljs` clears that immediately as a normally-versioned, actively-maintained package.
- Even though usage today is read-only, `exceljs` also covers writing — keeping the door open for a plausible future export-to-Excel feature (BOM export, catalog export, purchase-order export) without a second migration later, given this codebase's clear pattern of adding more import/export surface over time.
- `read-excel-file` is the smallest/lowest-risk option for *today's* usage specifically, but forecloses writing entirely — only worth it if E confirms no export-to-Excel feature is ever wanted.
- Formatting and formulas are non-issues either way; this app touches neither.

## 4. Proof-of-concept migration outline (steps only, no code changed)

1. Add `exceljs` to `package.json`; remove `xlsx` once both call sites are migrated and verified — not done in this pass.
2. Write one small shared helper (e.g. `parseWorkbookSheetToRows(buffer): Promise<Record<string, unknown>[]>`) that loads the workbook via `ExcelJS.Workbook().xlsx.load(buffer)`, takes `workbook.worksheets[0]` (mirrors today's "first sheet only" behavior at both sites), reads row 1 as headers, and walks the rest via `worksheet.eachRow` into the same shape `sheet_to_json` currently produces (matching `defval: ""` for blank cells, since the downstream loose-header-matching logic assumes string/blank values are present).
3. Replace `src/main.tsx:11912-11914` (inside `handleBomFileSelect`) to call the new helper. Leave everything after it (the `.map`/`findKey` field-mapping logic, `commitBomImport`) untouched — it only depends on the resulting row-object shape.
4. Replace `src/main.tsx:18703-18705` (inside `handleCatalogFileSelect`) the same way; leave its ~40 lines of field-mapping logic untouched.
5. Remove `import * as XLSX from "xlsx"` at `src/main.tsx:3`.
6. Manually test both import flows with real sample files (a BOM spreadsheet and a catalog spreadsheet, including blank cells, numeric-looking text cells, a header-only file) — `defval`/blank-cell handling is the main behavioral difference to verify between SheetJS and exceljs.
7. Confirm a clean production build (`npm run build`) with no Node-core polyfill warnings — needs a real build-and-smoke-test spike before committing to this, not assumed.
8. Run a dependency audit after the swap to confirm the flagged vulnerability class is gone.

## 5. Complete affected-file list (exhaustive)

- `package.json` — remove `xlsx`, add `exceljs`.
- `src/main.tsx:3` — the `xlsx` import.
- `src/main.tsx`, `handleBomFileSelect` (starts ~line 11903) — BOM spreadsheet import.
- `src/main.tsx`, `handleCatalogFileSelect` (starts ~line 18693) — bulk catalog import.
- (New, optional) one small shared parsing-helper module, to avoid duplicating the exceljs row-walking logic between the two handlers.

No other file references `xlsx` anywhere in the tracked repository.

## 6. What this pass did not do

No package was installed, removed, or upgraded. No code was changed. This is a recommendation for E's decision, not an implementation — matching the standing "evaluate a replacement before making any dependency change" instruction.
