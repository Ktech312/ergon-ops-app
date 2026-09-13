-- Read-only preflight for the Sales pricing migration (Queue C1.1). NOT a
-- migration -- nothing here writes anything. Packaged for E to run manually
-- in the Supabase SQL editor; this session has no direct SQL execution path
-- and does not inspect real pricing data outside of what E chooses to share
-- back, per the standing rule against reading real business data without an
-- authorized path.
--
-- Reports what the migration will actually need to backfill/handle:
--   1. Total existing sales_quote_bom_lines and how many are catalog-linked
--      vs. free-text (free-text lines have no catalog default to backfill
--      from -- they will need unit_price left at 0 with price_source
--      'manual_override' pending a rep's own entry, not guessed at).
--   2. Catalog-linked lines whose linked catalog_items row is itself
--      missing/retired, or has no resolvable sell price (default_sell_price
--      is 0/null AND unit_cost is 0/null) -- these can't be given a
--      meaningful default at all and should be flagged, not silently zeroed.
--   3. How many quotes/proposals exist today, since every existing proposal
--      version's content_snapshot predates the new pricing fields and needs
--      the optional/undefined-safe fallback path (never a false "$0" total).

-- 1. BOM line counts: catalog-linked vs. free-text.
select
  count(*) as total_bom_lines,
  count(*) filter (where catalog_item_id is not null) as catalog_linked_lines,
  count(*) filter (where catalog_item_id is null) as free_text_lines
from sales_quote_bom_lines
where deleted_at is null;

-- 2. Catalog-linked lines whose source catalog item can't produce a
--    meaningful default price (would need review, not a silent $0).
--    Note: computeCatalogSellPrice (src/main.tsx) is the real "catalog
--    default" the app already uses elsewhere (avgDealSize KPI) -- it
--    prefers unit_cost*(1+markup_percent/100) when unit_cost > 0, falling
--    back to default_sell_price only when unit_cost is 0/unset. A row only
--    lacks a meaningful default when BOTH are zero/null.
select
  bl.id as bom_line_id,
  bl.quote_id,
  bl.item_name,
  pc.id as catalog_item_id,
  pc.product_name,
  pc.is_retired,
  pc.default_sell_price,
  pc.unit_cost,
  pc.markup_percent
from sales_quote_bom_lines bl
join product_catalog pc on pc.id = bl.catalog_item_id
where bl.deleted_at is null
  and (
    pc.is_retired = true
    or (coalesce(pc.default_sell_price, 0) = 0 and coalesce(pc.unit_cost, 0) = 0)
  );

-- 2b. BOM lines whose catalog_item_id no longer resolves at all (a deleted
--     catalog item -- catalog_item_id is a nullable FK, so this is possible
--     without violating any constraint).
select bl.id as bom_line_id, bl.quote_id, bl.item_name, bl.catalog_item_id
from sales_quote_bom_lines bl
where bl.deleted_at is null
  and bl.catalog_item_id is not null
  and not exists (select 1 from product_catalog pc where pc.id = bl.catalog_item_id);

-- 3. Quotes and proposal versions affected by the backward-compatibility
--    path (every one of these predates pricing fields in its snapshot).
select
  (select count(*) from sales_quotes where deleted_at is null) as total_quotes,
  (select count(*) from sales_quotes where deleted_at is null and status = 'closed_won') as closed_won_quotes,
  (select count(*) from sales_quote_proposals) as total_proposal_versions;
