-- Migration 077: Billing Address on the Address Book modal (Project detail
-- page). E confirmed a single field, same shape as Client Address -- not a
-- saved multi-address list like Shipping (billing address doesn't usually
-- change per-shipment the way a delivery address does).

alter table projects add column if not exists billing_address text;
