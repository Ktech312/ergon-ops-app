-- Brings Product Catalog closer to Inventory's UI: adds a tags column
-- (same text[] pattern as inventory_items.inventory_tags from migration
-- 004), and resets category on the 304 rows imported from E's PandaDoc
-- export (flat_priced_products.csv) to a placeholder.
--
-- Those rows' category values are arbitrary nested path strings from the
-- export (e.g. "EnSight Signage/Signal Tech/Standard Catalog/Digital
-- Inserts Only", "Services", "Travel and Related Expenses") that don't
-- match the new fixed 9-category list E specified (VPUs, Cameras, Signage,
-- Camera Accessories, Sign Accessories, Network/Coms., EnSight Kits, Power,
-- Lighting). There's no reliable way to auto-map hundreds of free-text
-- values onto 9 buckets without risking silently mis-categorizing real
-- sales items, so instead every existing row is set to 'Uncategorized' --
-- a safe, deterministic bucket the app's new category dropdown also
-- offers -- and E can re-sort them via the catalog's new category filter.
alter table product_catalog add column if not exists tags text[] not null default '{}'::text[];
create index if not exists idx_product_catalog_tags on product_catalog using gin(tags);

update product_catalog set category = 'Uncategorized';
