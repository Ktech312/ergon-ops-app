-- Phase 3, Stage 5 (workspace-scoped uniqueness, reports, aggregates,
-- functions, triggers, and remaining indirect access paths) -- fourth
-- migration of this stage, same 2026-09-16 standing authorization as
-- migrations 155-166. Closes a CONFIRMED, LIVE, and actively
-- exploitable cross-workspace data leak in the three report views from
-- migration 001 (`report_inventory_on_hand`, `report_project_inventory_usage`,
-- `report_purchase_order_status`, never touched since):
--
--   select relname, pg_get_userbyid(relowner), reloptions,
--          has_table_privilege('anon', oid, 'SELECT'),
--          has_table_privilege('authenticated', oid, 'SELECT')
--   from pg_class where relkind = 'v' and relname in (...);
--
--     report_inventory_on_hand         | postgres | NULL | true | true
--     report_project_inventory_usage   | postgres | NULL | true | true
--     report_purchase_order_status     | postgres | NULL | true | true
--
-- E ran this directly against production, 2026-09-18. Confirmed WORSE
-- than the theoretical concern that flagged this item: not only is
-- every one of these views owned by `postgres` with no
-- `security_invoker` (meaning, under Postgres's pre-PG15 default view
-- semantics, the view's own query runs as the OWNER -- a superuser --
-- bypassing every underlying table's RLS entirely, regardless of the
-- querying user's own workspace), `anon` ALSO has SELECT on all three,
-- not just `authenticated`. This means a genuinely UNAUTHENTICATED
-- caller can query these views via the PostgREST API today and read
-- every workspace's full inventory-on-hand, project inventory usage,
-- and purchase-order status data -- no login required.
--
-- Fix, confirmed sufficient by re-reading each view's actual query
-- (migration 001, re-read directly, not from the planning doc's
-- earlier summary): `security_invoker = true` alone closes this
-- completely, with no view-body rewrite needed. Every one of these
-- three views INNER JOINs at least one table that is already correctly
-- workspace-scoped by RLS (report_inventory_on_hand ->
-- inventory_items/locations, both migration 159;
-- report_project_inventory_usage -> projects/inventory_items,
-- migrations 156/159; report_purchase_order_status ->
-- purchase_orders/vendors, migration 159) -- an INNER JOIN to a
-- correctly-RLS'd table drops the whole joined row the instant the
-- querying user cannot see that side of the join. `inventory_balances`/
-- `project_inventory_allocations` are ALSO already independently
-- workspace-scoped, via `inventory_item_owner_workspace_id()`/
-- `project_owner_workspace_id()` (both migration 160, its own Sections
-- 10/12) -- re-confirmed directly from that migration's real text, not
-- assumed stale from an earlier planning note. `purchase_order_lines`
-- was not independently re-checked (not exercised by this migration's
-- own canonical test, and `report_purchase_order_status` only LEFT
-- JOINs it, so a permissive policy there could at most add extra line
-- counts to an otherwise-correctly-visible row, never surface an
-- otherwise-invisible purchase order). `security_invoker = true` makes
-- each view's query run as the
-- CALLING user rather than the owner, so every one of those RLS
-- policies is finally actually evaluated.
--
-- `anon` access is revoked outright, not merely left to RLS -- there is
-- no legitimate anonymous-facing use case for internal
-- inventory/purchase-order operational reports (unlike the public
-- share-link RPCs, which are the app's one deliberate anon-facing
-- surface).
--
-- Confirm 167 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review -- treat as urgent,
-- same severity class as an active incident (anon-exploitable, not
-- just cross-workspace among logged-in users).

begin;

alter view public.report_inventory_on_hand set (security_invoker = true);
alter view public.report_project_inventory_usage set (security_invoker = true);
alter view public.report_purchase_order_status set (security_invoker = true);

revoke select on public.report_inventory_on_hand from anon;
revoke select on public.report_project_inventory_usage from anon;
revoke select on public.report_purchase_order_status from anon;

commit;
