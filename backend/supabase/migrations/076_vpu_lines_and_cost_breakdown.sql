-- Migration 076: two independent additions, bundled into one script so E
-- only has to run one thing.
--
-- 1. VPU's becomes a real per-location line-item section, same pattern as
--    Camera/Sign/Sensor/Misc (migration 071) -- just widens the existing
--    line_type check constraint, no new table needed.
--
-- 2. Cost Breakdown / Cost Snapshot on the Project detail page: a one-time
--    hardware/install "sale amount" (separate from the recurring SaaS
--    contract added in migration 073), plus Estimated Labor, Subcontractor,
--    and Travel cost fields a PM fills in. Sale amount lives on the Sales
--    Quote (the actual signed deal) and carries over to the Project when
--    created from a Closed - Won quote, same one-time-copy pattern as SaaS
--    -- and stays independently editable on the Project after that, since a
--    PM may need to correct/refine it post-close.

alter table sales_quote_location_items
  drop constraint if exists sales_quote_location_items_line_type_check;
alter table sales_quote_location_items
  add constraint sales_quote_location_items_line_type_check
  check (line_type in ('sign', 'sensor', 'misc', 'camera', 'vpu'));

alter table project_location_items
  drop constraint if exists project_location_items_line_type_check;
alter table project_location_items
  add constraint project_location_items_line_type_check
  check (line_type in ('sign', 'sensor', 'misc', 'camera', 'vpu'));

alter table sales_quotes add column if not exists sale_amount numeric;

alter table projects add column if not exists sale_amount numeric;
alter table projects add column if not exists estimated_labor_cost numeric;
alter table projects add column if not exists subcontractor_cost numeric;
alter table projects add column if not exists travel_expenses numeric;
