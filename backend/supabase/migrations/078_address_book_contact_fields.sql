-- Migration 078: Address Book redesign -- E wants one clean, tight card
-- format for every address (Name(s) / Address / Home Phone / Cellphone /
-- Work Phone / Office), matching a physical address-book template. Client
-- and Billing stay single records (a project has one client, one billing
-- contact); Shipping stays a list (a project can genuinely ship to several
-- different sites) -- same architecture as before, just every entry now
-- carries the same complete contact info instead of Client/Billing being
-- bare address strings and Shipping only having one generic phone number.

alter table projects add column if not exists client_home_phone text;
alter table projects add column if not exists client_cell_phone text;
alter table projects add column if not exists client_work_phone text;
alter table projects add column if not exists client_office_phone text;

alter table projects add column if not exists billing_name text;
alter table projects add column if not exists billing_home_phone text;
alter table projects add column if not exists billing_cell_phone text;
alter table projects add column if not exists billing_work_phone text;
alter table projects add column if not exists billing_office_phone text;

alter table project_shipping_addresses add column if not exists home_phone text;
alter table project_shipping_addresses add column if not exists cell_phone text;
alter table project_shipping_addresses add column if not exists work_phone text;
-- The existing `phone` column becomes the "Office" field in the new card
-- layout (E: "Change Fax to Office") -- no rename needed, just relabeled
-- in the UI, so New Shipment (which already writes to this column) needs
-- no changes.
