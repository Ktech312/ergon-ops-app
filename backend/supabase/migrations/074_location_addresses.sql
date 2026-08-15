-- Migration 074: per-garage/lot Address.
--
-- Three distinct addresses now exist for a project: the Client's own
-- address (projects.site_address, unchanged, edited in Project
-- Information), each garage/lot's own physical address (new, this
-- migration -- a project can span multiple sites that aren't all at the
-- same address), and the separate saved Shipping Address book
-- (project_shipping_addresses, migration 072, used when requesting a
-- shipment). Keep these three separate -- don't collapse them back into
-- one field.

alter table project_locations add column if not exists address text not null default '';
alter table sales_quote_locations add column if not exists address text not null default '';
