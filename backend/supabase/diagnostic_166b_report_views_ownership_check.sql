-- Read-only diagnostic for Stage 5's report-views item. Confirms
-- (or rules out) the suspected cross-workspace data leak in
-- report_inventory_on_hand / report_project_inventory_usage /
-- report_purchase_order_status (all from migration 001, never touched
-- since) before any fix is written. Nothing here writes, alters, or
-- locks anything -- pure catalog reads.
--
-- What this checks: under Postgres's pre-PG15 default view semantics, a
-- view runs its underlying query as the VIEW OWNER, not the querying
-- user, unless security_invoker=true is set -- which would mean every
-- authenticated user currently sees UNFILTERED, cross-workspace
-- aggregate data through all three views regardless of their own
-- workspace's RLS policies. If the owner is a low-privilege role and/or
-- security_invoker is already true, there may be no real gap here at
-- all -- this query settles it either way.

select
  c.relname as view_name,
  pg_get_userbyid(c.relowner) as view_owner,
  c.reloptions as view_options,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_select
from pg_class c
where c.relkind = 'v'
  and c.relname in ('report_inventory_on_hand', 'report_project_inventory_usage', 'report_purchase_order_status')
order by c.relname;
