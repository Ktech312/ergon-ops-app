-- URGENT. Found while scoping the final Phase 3 cross-workspace
-- isolation suite (not yet built -- this fix stands on its own).
-- `sales_quote_ref_counters`/`project_ref_counters` (migrations
-- 066/067) got a real `workspace_id` column and a composite
-- `(workspace_id, year)` primary key in migration 164 -- but migration
-- 164 never touched either table's RLS policy, which is still the
-- ORIGINAL, fully-open policy from 066/067:
--
--   create policy "authenticated read sales_quote_ref_counters"
--     on sales_quote_ref_counters for select to authenticated using (true);
--   create policy "authenticated write sales_quote_ref_counters"
--     on sales_quote_ref_counters for all to authenticated using (true) with check (true);
--   -- (identical shape for project_ref_counters, 067:24-28)
--
-- Right now, any authenticated user -- in any workspace -- can read
-- AND directly INSERT/UPDATE/DELETE any other workspace's counter row
-- via a raw REST call, including forging another workspace's
-- `next_seq` value (which would corrupt that workspace's next
-- `SQ-.../PRJ-...` reference number) or deleting it outright (which
-- would make its next real insert silently restart at `0001`,
-- colliding with an already-issued reference). This is a real,
-- currently-live gap this session's own migration 164 introduced by
-- adding a real workspace_id without also re-scoping RLS to match --
-- caught only now, while inventorying the whole schema for the final
-- isolation suite, not by anything migration 164's own test checked
-- (its test only exercises `assign_sales_quote_ref()`/
-- `assign_project_ref()`, both `security definer` and therefore
-- correctly bypassing RLS regardless of the policy's own state -- the
-- raw-table policy gap was invisible to that test by construction).
--
-- Confirmed via direct grep of `src/persistence.ts`: the app never
-- writes to either table directly -- the only legitimate writers are
-- `assign_sales_quote_ref()`/`assign_project_ref()` themselves, both
-- `security definer` (migration 164), which bypass RLS entirely
-- regardless of this policy. There is no legitimate direct-write path
-- for an ordinary authenticated client at all.
--
-- Fix: scope SELECT to workspace membership (harmless transparency,
-- matches every other table's own read policy); remove the "authenticated
-- write" policy entirely rather than merely re-scoping it, since no
-- legitimate direct write path exists -- removing it, rather than
-- narrowing it, closes the forge/delete risk completely without
-- affecting the one real write path (the security-definer triggers),
-- which never went through RLS in the first place.
--
-- Confirm 174 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review -- URGENT, same
-- severity class as prior live-incident fixes this session.

begin;

drop policy if exists "authenticated read sales_quote_ref_counters" on public.sales_quote_ref_counters;
drop policy if exists "authenticated write sales_quote_ref_counters" on public.sales_quote_ref_counters;

create policy "workspace members read sales_quote_ref_counters"
  on public.sales_quote_ref_counters for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "authenticated read project_ref_counters" on public.project_ref_counters;
drop policy if exists "authenticated write project_ref_counters" on public.project_ref_counters;

create policy "workspace members read project_ref_counters"
  on public.project_ref_counters for select to authenticated
  using (public.is_workspace_member(workspace_id));

commit;
