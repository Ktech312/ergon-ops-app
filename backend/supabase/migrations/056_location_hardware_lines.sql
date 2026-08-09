-- Feeds real, catalog-linked equipment selections into each Site Builder
-- location, so the BOM for an individual facility (and eventually the
-- whole quote/project) is built from actual product picks instead of just
-- checkbox-driven Site Hardware Rules estimates.
--
-- 1. FLI/LPR/People Counting each get an optional specific camera model
-- (a real product from the catalog), instead of only a yes/no checkbox.
alter table sales_quote_locations add column if not exists fli_camera_item_id uuid references product_catalog(id) on delete set null;
alter table sales_quote_locations add column if not exists lpr_camera_item_id uuid references product_catalog(id) on delete set null;
alter table sales_quote_locations add column if not exists people_counting_camera_item_id uuid references product_catalog(id) on delete set null;

-- 2. Addable Sign / Space Sensor / Misc line items per location. One table
-- with a line_type discriminator rather than three near-identical tables --
-- same catalog_item_id + qty shape either way, just filtered to a
-- different slice of the catalog in the UI (Signage category, Space
-- Sensors category / "sensor" tag, or the entire catalog for Misc).
-- catalog_item_id is nullable (on delete set null) so retiring/deleting a
-- catalog item orphans the line instead of silently deleting a quantity
-- the sales team already committed to -- the app should surface that as
-- "item removed from catalog" rather than losing the row.
create table if not exists sales_quote_location_items (
  id uuid primary key default gen_random_uuid(),
  quote_location_id uuid not null references sales_quote_locations(id) on delete cascade,
  line_type text not null check (line_type in ('sign', 'sensor', 'misc')),
  catalog_item_id uuid references product_catalog(id) on delete set null,
  qty numeric not null default 1,
  line_sort integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_quote_location_items_location on sales_quote_location_items(quote_location_id, line_type, line_sort);

alter table sales_quote_location_items enable row level security;

-- Same openness as sales_quote_locations/sales_quotes (migration 033) --
-- any authenticated user can read/write, consistent with the rest of the
-- Sales side of the app.
create policy "authenticated read sales_quote_location_items"
  on sales_quote_location_items for select to authenticated using (true);

create policy "authenticated write sales_quote_location_items"
  on sales_quote_location_items for all to authenticated using (true) with check (true);
