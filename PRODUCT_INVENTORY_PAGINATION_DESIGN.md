# Inventory Pagination — Design (Queue B6, NOT IMPLEMENTED)

Status: **DESIGN ONLY. No production code, no migration.** Written for `CONTINUOUS_CODER_HANDOFF.md`
Queue B6, informed by decision **D10** (§8 of that document) — "server-side search + cursor
pagination; preserve selected rows outside the current page" — already recorded as the working
direction, not a blocking open question the way D1/D2/D9 are for their own items. This document
traces every real consumer of `loadInventoryItems` before proposing anything, per the task's own
instruction, and does **not** cap the existing alphabetical query — see §5.

## 1. Every `loadInventoryItems` consumer, traced

`loadInventoryItems` (`src/persistence.ts:5421`) issues one unbounded
`inventory_items?select=...&order=item_name.asc` request (no `limit`/`offset`, no `Range` header) and
is called from exactly two places: the initial session load (`main.tsx:1822`) and the post-restore
reload (`main.tsx:6847`). Its result populates one React state array, `inventoryItems`, read from
**114 locations** in `main.tsx`. Grouped by what they actually need:

1. **~30 `.find()` lookups by `ref` or `name`** — BOM/component resolution (device recipes, Project
   BOM lines, purchasing, task hardware, movements, one-off-item detection), each needing to resolve
   one specific item, not browse a list. Examples: `main.tsx:2011`, `:4992`, `:5946`, `:6017`, `:6247`,
   `:10061`, `:12436`.
2. **Two independent full-array client-side filtered table views**: the main Inventory page
   (`filteredInventoryItems`, `main.tsx:10126` — filters by ref/part/category/manufacturer/status/tag)
   and the Reports/Purchasing page's own separate filter (`main.tsx:16686` — filters by vendor and a
   combined search term). These are the actual pagination targets — everything else in this list needs
   the full set or one specific item, not a browsable page of results.
3. **~6 full-list `<select>` dropdowns** — device recipe component picker (`:11189`, `:11201`), the
   Add-to-BOM part picker (`:12090`), part-adjust/transfer pickers (`:11136`, `:11495`), each rendering
   every non-retired item as an `<option>`.
4. **Global search** (`:5688`) — matches a typed term against every item's ref/name/description/
   manufacturer/category, across the whole array, surfaced in the app's top-level search.
5. **Derived aggregate values** — `lowStock` (`:1378`), `distinctInventoryTags` (`:10124`),
   `oneOffItems` (`:10155`), `vendorOptions` (`:16678`) — each a full-array reduction, not a
   page-scoped one.

**The core constraint this design must respect**: categories 1, 3, 4, and 5 all genuinely need the
full set (or a full-set derivation) client-side today, and none of them are what D10 or this task
actually asks to paginate. Only category 2 — the two big browsable tables — is the actual target.
Naively paginating the `inventoryItems` array itself would silently break all 30+ lookups, every
dropdown, global search, and every aggregate the moment the real inventory count exceeds one page.

## 2. Recommended shape: two independent things, not one paginated array

**Keep `loadInventoryItems`/`inventoryItems` exactly as-is** for categories 1, 3, 4, 5 — the full,
unbounded, alphabetical load this app already relies on everywhere except the two table views. This
is precisely why the task says not to cap the existing alphabetical query: doing so would fix the two
tables' scale problem by breaking thirty unrelated things that were never the problem.

**Add one new, separate query** — server-side searched, cursor-paginated — used *only* by the
Inventory page's own table and (optionally, same shape) the Reports page's inventory filter. It does
not replace `inventoryItems`; it is a second, independent data source that happens to describe rows
from the same table.

```ts
// Illustrative signature only -- not implemented.
type InventoryPage = {
  items: Part[];
  nextCursor: string | null; // opaque, encodes (item_name, id) of the last row
};

async function loadInventoryItemsPage(
  params: { search: string; category?: string; status?: string; tag?: string; cursor?: string | null; pageSize: number },
  accessToken?: string,
): Promise<InventoryPage>;
```

**Cursor, not offset** — matching D10's own wording and this app's existing keyset-style patterns
(e.g. version ordering elsewhere). Stable order is `(item_name asc, id asc)` — the same `item_name.asc`
this app already sorts by, with `id` as a tiebreaker for rows that share a name, so a cursor
`(last_item_name, last_id)` unambiguously identifies "everything after this row" even under
concurrent inserts between page loads. A PostgREST query for this shape:
`inventory_items?select=...&order=item_name.asc,id.asc&and=(item_name.gt.<last_name>,or(item_name.eq.<last_name>,id.gt.<last_id>))&limit=<pageSize>`
(illustrative — exact PostgREST `or`/`and` composition to be verified against a real query at
implementation time, not guessed here).

**Server-side search** filters on the same fields the existing client-side filter already checks
(`ref`, `name`, `description`, `manufacturer`, `category`, computed status, `tags`) — same semantics
the user already has, just evaluated server-side instead of over an in-memory array. Category/status/
tag filters become query parameters rather than a post-fetch `.filter()`.

## 3. Selected-item hydration (the specific gap D10 names)

A row can become "selected" without being on the currently-loaded page in at least three ways this
app already supports today and must keep supporting: (a) editing a row found via barcode scan or the
`ref`/name search box (`main.tsx:10470`/`:18966`), (b) a deep link or cross-page navigation that opens
a specific item by `ref`, (c) an item referenced by something else on screen (e.g. a low-stock alert,
a BOM line) that the user clicks through to. In every case, the selected item must render correctly
even if it isn't in the currently-loaded page's `items` array.

**Rule**: when a selection targets an item not present in the current page's loaded set, fetch that
one row directly by `ref` (a single-row, unpaginated lookup — cheap, already the same shape as
existing `.find()`-by-ref usage) and merge it into local component state as a standalone "pinned"
entry, kept visible (e.g. pinned to the top of the table, clearly marked "not part of the current
filtered page") until deselected or the filter/search changes. This mirrors the same principle
`CatalogItemPicker`/`PeoplePicker` already use — search resolves independently of whatever the visible
list currently shows, never requiring the full list to be loaded to find one specific match.

## 4. Empty / loading / error states

Matches this app's existing conventions rather than inventing new ones:

- **Loading**: existing per-page loading indicator pattern, shown only for the paginated table's own
  fetch — the rest of the page (built from the still-full `inventoryItems`) is unaffected and doesn't
  need to wait on it.
- **Empty**: a real "no items match these filters" state, distinguished from a load failure — same
  distinction `PRODUCT_ERROR_VISIBILITY_AUDIT.md` §4 already flags as commonly conflated elsewhere in
  this app; this design must not repeat that mistake for its own new code path.
- **Error**: on a failed page fetch, show the last successfully loaded page with a plain "couldn't
  refresh — showing the last loaded page" banner (same "last known good" pattern proposed for System
  Health's own read side, Queue B4 §10) rather than a blank or crashed table.
- **Load more**: a cursor-based "Load more" control (or scroll-triggered continuation) appends to the
  currently-rendered set; changing search/filter parameters discards the current page set and starts
  a fresh cursor from the beginning, rather than trying to reconcile the two.

## 5. Explicit non-goal, per the task's own instruction

**Do not cap the existing alphabetical query.** `loadInventoryItems` stays exactly as unbounded as it
is today. One real, related finding worth naming here rather than silently fixing: that query already
has no `limit`, so if the live PostgREST instance has any configured default row cap
(`db-max-rows`/Supabase's own default, not checked against the live project as part of this
design-only pass), an inventory count that ever exceeds it would **already silently truncate today**,
with none of the 114 consumers above any wiser — every lookup, dropdown, and aggregate would just be
missing whatever fell past the cap, with no error surfaced anywhere. This is a pre-existing risk this
design does not create and is not scoped to fix (it would require either confirming no such cap
exists in production, or a genuinely different fix — a keyset-paginated full-load loop for
`loadInventoryItems` itself, which is a larger change than D10 asked for) — named here as a candidate
System Health / follow-up item, not solved by this document.

## 6. Recommended default UX (interaction sketch)

The Inventory page keeps its existing filter bar (ref/part/category/manufacturer/status/tag) exactly
where it is, visually unchanged. Typing in any filter debounces (matching the existing debounce
convention already used elsewhere in this app, e.g. the 650ms save-debounce pattern, though a shorter
~300ms read-debounce is more appropriate for a search-as-you-type field) and issues a fresh
`loadInventoryItemsPage` call with `cursor: null`, replacing the rendered set. The table shows a fixed
page size (recommend 50, matching a comfortable single-screen scroll, not a specific measured number —
tunable at implementation time) with a **Load more** button below the table rather than infinite
scroll, since a button gives the user an obvious, discoverable affordance and avoids the "how far did
I scroll" disorientation infinite scroll can cause in a data-management table like this one (this app
favors explicit controls over implicit ones elsewhere too — e.g. the Move up/down reorder buttons
chosen over drag-and-drop in Queue A3/A4). A pinned "not in current filter" row (per §3) renders in a
visually distinct strip above the normal table body whenever active.

## 7. What this document deliberately does not do

It does not add or alter `loadInventoryItems`, does not add a new persistence function, does not
touch `main.tsx`, and does not add a test file or migration. It does not resolve the possible
PostgREST row-cap risk named in §5 — that is flagged, not fixed, here.
