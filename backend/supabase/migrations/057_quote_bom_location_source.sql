-- Traces a Quote BOM line back to the Site Builder location it was pulled
-- from (camera model picks, Signs, Space Sensor, Misc -- migration 056),
-- so "Pull Location Hardware into Quote BOM" can regenerate its own lines
-- without touching lines a rep added by hand at the quote level (those
-- keep source_location_id null). Nullable + on delete set null: removing
-- a location later shouldn't delete a quantity already committed to the
-- quote BOM, just orphan the traceability link.
alter table sales_quote_bom_lines add column if not exists source_location_id uuid references sales_quote_locations(id) on delete set null;

create index if not exists idx_sales_quote_bom_lines_source_location on sales_quote_bom_lines(source_location_id);
