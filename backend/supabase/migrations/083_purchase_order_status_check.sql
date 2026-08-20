-- Migration 083: fix a real bug -- Create Purchase (and "Received All"/the
-- Waiting on Receiving status dropdown) has been silently failing to save
-- since migration 081 shipped.
--
-- Migration 032 added purchase_orders.app_status as a checked text column
-- allowing only ('Imported', 'In Processing', 'On Hold') -- the three
-- legacy statuses that existed before "Create Purchase". Migration 081
-- introduced 'Ordered'/'Received' as real app-level statuses (Create
-- Purchase defaults new orders to 'Ordered'; Waiting on Receiving's status
-- dropdown and the receiving-log auto-flip both write 'Received') but
-- never widened this constraint to allow them. Every insert/update that
-- wrote 'Ordered' or 'Received' into app_status has been rejected by
-- Postgres with a check-constraint violation (surfaced to the app as a
-- plain 400), which the UI didn't distinguish from a generic failure --
-- E: "the green pop up came up and says 'see it in Waiting below' but it
-- never went down there." The order was never actually created.

alter table purchase_orders drop constraint if exists purchase_orders_app_status_check;
alter table purchase_orders add constraint purchase_orders_app_status_check
  check (app_status in ('Imported', 'In Processing', 'On Hold', 'Ordered', 'Received'));
