# Frozen Sales Pricing — Implementation Plan (Queue B2 design; implemented Queue C1)

Status: **IMPLEMENTED LOCALLY, NOT YET DEPLOYED.** E approved the recommended pricing statement on
2026-09-13 (catalog price starts each line; Sales may override with an audit record; each sent
proposal version freezes its own prices; customers see unit price/line total/subtotal/discount/tax/
final total; costs/margin stay internal; the accepted total carries to the Project as a read-only
reference; approval thresholds remain a separate later decision) and Queue C1.1–C1.9 executed
continuously against it. Code, tests, and the migration package are complete and committed locally.
**Not pushed to `main` yet** — migration 136 must be reviewed and run by E first (frontend code now
depends on its new columns; pushing before it runs would 400 every Sales page load in production,
per this repo's own established migration-then-frontend sequencing discipline). See `HANDOFF.md`'s
Queue C1 entry for exact file-by-file detail and the current blocker.

## 1. Current state, traced

- `CatalogItem` (`src/persistence.ts:2178`) already has a full internal pricing model:
  `defaultSellPrice`, `unitCost`, `markupPercent`, `costSource`. This is real and used for internal
  KPIs (`estimatedProfitYtd`/`avgDealSize`, `main.tsx`) but never reaches a quote or proposal.
- `SalesQuoteBomLine` (`src/persistence.ts:9332`) has **no price field at all** — `item`, `qty`,
  `notes`, `catalogItemId`, `sourceLocationId`, `lineSort`. Confirmed against the live
  `sales_quote_bom_lines` table (migration 048): no price column exists.
- `ProposalBomLineSnapshot` / `ProposalSnapshot` (`src/persistence.ts:11690`/`11707`) — the frozen,
  customer-facing content sent with a proposal — carries `item`, `qty`, `notes`, `imageUrl`,
  `description`, `manufacturer`, `hasDatasheet`, `datasheetUrl`. No `unitPrice`, no `lineTotal`, no
  subtotal, no tax, no discount, no grand total anywhere in the type or in `ProposalPublicPage`'s
  rendered table.
- No `sales_quotes` column and no table anywhere in `backend/supabase/migrations/` currently
  represents a discount, a tax rate, or a grand total. This is a from-scratch addition, not a gap in
  an existing partially-built feature.
- `compareProposalSnapshots` (`src/persistence.ts:11863`, shipped Queue A5) already drives its
  top-level and BOM-line diffs off two explicit field lists (`PROPOSAL_BOM_LINE_COMPARED_FIELDS` and
  an inline tuple of top-level fields) — adding pricing fields to those two lists is the *entire*
  integration cost for version comparison to pick up price changes across sent versions; no new
  comparison logic is needed.

## 2. The pricing model, defined per D2

**Catalog-default price.** `CatalogItem.defaultSellPrice` remains exactly what it is today — the
starting point offered when a rep adds a catalog-linked BOM line to a quote. No change to the Catalog
schema or UI.

**Editable quote price.** A new `sales_quote_bom_lines.unit_price` column, populated from
`defaultSellPrice` at the moment a catalog-linked line is added (or left for the rep to fill in
directly, for free-text labor/service lines that have no catalog entry — the same mixed-line reality
`SalesQuoteBomLine.catalogItemId` already documents as nullable-on-purpose). Freely editable
afterward by Sales. Per D2 ("may deliberately override with audit"): store `price_source`
(`"catalog_default"` | `"manual_override"`) and `price_overridden_at`/`price_overridden_by` — set
only when the rep's value differs from the catalog default at write time, never inferred after the
fact. This is an audit trail, not an approval gate — D2 does not ask for a threshold or approval step
here (that is D4's separate scope, "customer pricing detail and approval threshold").

**Frozen proposal price.** `ProposalBomLineSnapshot` gains `unitPrice` and `lineTotal` (`qty *
unitPrice`, computed once at send time and stored as a plain number, never recomputed from the live
quote afterward) — frozen exactly the same way `imageUrl`/`description`/`manufacturer` are already
frozen from the catalog item at send time, for the exact same reason: a later catalog or quote price
change must never silently rewrite a proposal a client has already seen or responded to.

**Internal cost/margin visibility.** `unitCost` and `markupPercent` (whichever produced the frozen
`unitPrice`) **never** enter `ProposalBomLineSnapshot` or any other customer-reachable payload — this
matches the existing, deliberate exclusion already documented at
`053_sales_quote_proposals.sql:145-146` ("never quote internal cost/markup data") and simply extends
it to the new fields. Margin stays visible only in an internal-only Sales Quote Builder summary
(subtotal of `unitCost * qty` vs. `unitPrice * qty` per line, and a quote-level total), gated by the
same role set that already sees `estimatedProfitYtd`/`avgDealSize` today — no new role or permission
concept.

**Tax/discount scope.** Quote-level, not per-line — a single `discount_percent` (or a flat
`discount_amount`; §3 below lists both as open sub-choices, not yet decided) and a single `tax_rate`
per quote, matching how a real sales quote is actually negotiated (one discount/tax applied to the
whole deal, not itemized per BOM line). Frozen into the proposal snapshot as computed dollar amounts
(`subtotal`, `discountAmount`, `taxAmount`, `grandTotal`) at send time, never live-recomputed on the
public page — same "frozen at send" principle as the line prices.

**Version behavior.** Because every pricing number is frozen into `ProposalSnapshot` at send time
exactly like the existing fields, each sent proposal version already freezes its own prices/costs by
construction — this is D2's third clause satisfied by the same mechanism already used for everything
else in the snapshot, not a separate feature. Add `unitPrice`, `lineTotal` to
`PROPOSAL_BOM_LINE_COMPARED_FIELDS` and `subtotal`, `discountAmount`, `taxAmount`, `grandTotal` to the
top-level compared-fields tuple in `compareProposalSnapshots` — the existing A5 comparison view then
shows price changes between versions with zero new UI work.

**Conversion carry-through.** `create_project_from_quote` (migrations 127/128, and the drafted-not-run
134) inserts a `projects` row with no price-related column at all today, and Projects/PM tooling has
no concept of displaying a dollar figure anywhere in the app. Recommended scope for this pass:
**do not** carry per-line pricing into `project_location_items` or any Project BOM table — that would
require Projects to grow its own pricing display surface, which is unscoped and unrequested. The only
carry-through worth doing is copying the quote's final frozen `grandTotal` (from whichever proposal
version was actually accepted) onto the Project as a single read-only reference number, the same way
`client_id` carry-through (Queue A2/migration 134) copies one existing value across without inventing
new Project-side behavior. **This is a new, small open sub-question, not yet in the decision
register** — flagged here rather than silently decided, per the standing rule against inventing Sales
authority rules. If E does not want even the read-only total carried through, the simplest correct
answer is "no conversion carry-through in this pass," and nothing here blocks D2 from being answered
without it.

## 3. Schema (migration pseudocode — NOT a runnable migration)

Confirm the next free migration number at execution time (134 is already taken by the drafted,
not-yet-run Queue A2 package; this would land after whatever is live by then — do not assume a
specific number).

```sql
-- sales_quote_bom_lines: quote-editable price + audit trail
alter table sales_quote_bom_lines
  add column if not exists unit_price numeric(12,2) not null default 0,
  add column if not exists price_source text not null default 'catalog_default'
    check (price_source in ('catalog_default', 'manual_override')),
  add column if not exists price_overridden_by uuid references auth.users(id),
  add column if not exists price_overridden_at timestamptz;

-- sales_quotes: quote-level discount/tax (open sub-choice: percent vs. flat amount for discount --
-- percent is recommended, since a flat dollar discount does not scale sensibly if line items change
-- after it is set; needs E's confirmation, not decided here)
alter table sales_quotes
  add column if not exists discount_percent numeric(5,2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  add column if not exists tax_rate numeric(5,2) not null default 0
    check (tax_rate >= 0);

-- No RPC needed: BOM line price edits are simple checked PATCH writes, same shape as every other
-- sales_quote_bom_lines field today (updateSalesQuoteBomLine). Sending a proposal already goes
-- through one function that reads the current quote + lines and writes content_snapshot -- that
-- function is extended to also compute and freeze subtotal/discountAmount/taxAmount/grandTotal at
-- that same point, not a new code path.
```

RLS: both tables already have wide-open authenticated read/write policies (migration 048/033, "no
single role owns this workflow yet") — per the standing migration checklist, no new policy is needed
since no new table is created; existing policies already cover the new columns.

Test matrix to accompany the real migration once D2 is answered (not written yet):

1. A catalog-linked BOM line defaults `unit_price` to the catalog item's `defaultSellPrice` and
   `price_source` stays `'catalog_default'` until edited.
2. Editing a line's price sets `price_source = 'manual_override'` and stamps
   `price_overridden_by`/`price_overridden_at`; editing it back to exactly the catalog default value
   does not silently revert `price_source` (an explicit choice was made either way, and the audit
   trail should reflect that a human touched it, not guess intent from the resulting number).
3. Sending a proposal freezes `unitPrice`/`lineTotal` per line and `subtotal`/`discountAmount`/
   `taxAmount`/`grandTotal` at the quote level into that version's `content_snapshot`; a later catalog
   price change or quote-level discount/tax edit does not alter an already-sent version's snapshot.
4. `compareProposalSnapshots` between two versions with different `unit_price` on the same item name
   reports a `changed` BOM line with `unitPrice` (and `lineTotal`) in `changedFields`.
5. `unitCost`/`markupPercent` never appear in `content_snapshot` at any point (a payload-shape
   assertion, same spirit as the existing "internal cost/markup never quoted" comment it's extending).
6. A pre-existing proposal sent before this feature exists compares/loads cleanly with the new fields
   absent (`unitPrice`/`lineTotal`/`subtotal`/etc. treated as `undefined`/0, not a crash) — same
   backward-compatibility pattern already proven for `companyName`/`companyLogoUrl` in
   `proposal-version-comparison.test.ts`.

## 4. UI touch points (not built yet)

- **Sales Quote Builder** (`src/main.tsx`): a Unit Price column on each BOM line (defaulting from the
  catalog item, editable, with a small "override" indicator when it differs from the catalog default
  and who/when changed it), quote-level Discount % and Tax % fields, and a read-only internal summary
  block (subtotal, discount, tax, grand total, and margin — margin gated the same way
  `estimatedProfitYtd` already is).
- **Customer Presentation / `ProposalPublicPage`**: a price column per BOM row and a totals block
  (subtotal, discount, tax, grand total) rendered from the frozen snapshot only — this directly closes
  the gap `PRODUCT_SALES_DISCOVERY.md` names as the single largest reason Ergon cannot replace
  PandaDoc today.
- **Proposal version comparison** (already shipped, Queue A5): no new UI — extending the two compared-
  field lists above is sufficient for price changes to show up automatically.

## 5. What this document deliberately does not do

It does not add or alter any migration file, does not touch `src/main.tsx` or `src/persistence.ts`,
and does not add a test file. It leaves two things explicitly open rather than deciding them: (a)
percent vs. flat-amount discount, and (b) whether the accepted proposal's `grandTotal` should be
carried onto the converted Project at all. Both are named, not silently resolved, per the standing
rule against inventing Sales/Billing authority rules on this pass's own judgment.
