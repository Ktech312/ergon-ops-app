-- Migration 071: Cameras become an addable line-item section (like Signs
-- and Space Sensors already are) instead of the three single-pick
-- fli_camera_item_id / lpr_camera_item_id / people_counting_camera_item_id
-- columns on the location row. FLI / LPR / People Counting stay on the
-- location row as plain reference checkboxes (per E: "this is only for
-- reference, it should not trigger anything at this point") -- their old
-- *_camera_item_id columns are left in place but the UI no longer writes
-- to them.
--
-- Every line (camera / sign / sensor -- misc too, for consistency, since
-- they all render through the same shared component) gets a free-text
-- "where in this garage/lot" location label, plus an optional accessory
-- pick + qty. Accessory dropdowns are scoped by catalog tag ("Camera
-- accessory" / "Sign accessory" / "Sensor accessory"), not category --
-- those tags get applied to catalog items separately, in the app.

alter table sales_quote_location_items
  drop constraint if exists sales_quote_location_items_line_type_check;
alter table sales_quote_location_items
  add constraint sales_quote_location_items_line_type_check
  check (line_type in ('sign', 'sensor', 'misc', 'camera'));
alter table sales_quote_location_items add column if not exists location_label text not null default '';
alter table sales_quote_location_items add column if not exists accessory_catalog_item_id uuid references product_catalog(id) on delete set null;
alter table sales_quote_location_items add column if not exists accessory_qty numeric not null default 0;

alter table project_location_items
  drop constraint if exists project_location_items_line_type_check;
alter table project_location_items
  add constraint project_location_items_line_type_check
  check (line_type in ('sign', 'sensor', 'misc', 'camera'));
alter table project_location_items add column if not exists location_label text not null default '';
alter table project_location_items add column if not exists accessory_catalog_item_id uuid references product_catalog(id) on delete set null;
alter table project_location_items add column if not exists accessory_qty numeric not null default 0;
