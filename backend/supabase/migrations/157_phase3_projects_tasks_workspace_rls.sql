-- Phase 3, Stage 2 RLS half (Projects, tasks, locations, BOM, and
-- related delivery records) -- approved by E under the same 2026-09-16
-- standing authorization as migrations 155/156. This is the RLS half of
-- Stage 2, following migration 156's ownership half (projects.workspace_id/
-- tasks.workspace_id, confirmed applied and tested in production
-- 2026-09-17) exactly the way migration 155 followed migration 117 for
-- Clients+Sales.
--
-- Table-group scope: the 14 tables migration 156's own header already
-- scoped and justified (`projects`, `tasks`, plus 12 tables inheriting
-- ownership through their FK) -- not re-derived here. One exception:
-- `project_conversion_receipts` is NOT touched -- it already has RLS
-- enabled with ZERO policies, by deliberate permanent design (migration
-- 127: "not a placeholder to fill in later" -- table-level privileges
-- are revoked from anon/authenticated entirely, so no role except the
-- table owner/service_role can reach it at all). Adding a workspace
-- policy to it would be strictly less restrictive than what already
-- exists -- the opposite of this migration's job.
--
-- Material drift found from a naive "treat every table like Group 1's
-- clients/sales_quotes" assumption, confirmed by direct read before
-- writing any policy below (not assumed identical to Group 1):
--   1. `projects` itself is NOT using(true) for writes -- migration 023
--      already replaced its write policy with `pm and admin write
--      projects` (using(is_app_admin(auth.uid()) or has_role('pm'))).
--      Same for `project_scope_of_work` and `project_bom_lines` (both
--      also migration 023). The workspace predicate is added ALONGSIDE
--      these existing role gates via AND, not instead of them -- exactly
--      T2's "alongside, not instead of" framing, the same pattern
--      already used for sales_quote_proposal_approval_requests in
--      migration 155.
--   2. `project_submittals` has had NO write policy since migration 144
--      (the same "close share-link direct-write bypasses" migration
--      that also closed sales_quote_proposals' write policy) -- every
--      write already goes through create_and_send_submittal_version()/
--      respond_to_submittal() only. This migration adds SELECT-only
--      scoping and deliberately does NOT add an insert/update/delete
--      policy, matching sales_quote_proposals' own treatment in
--      migration 155.
--   3. `task_activity_log` has never had an update/delete policy at all
--      (read + insert only, by design -- an append-only audit log).
--      This migration preserves that shape exactly: SELECT + INSERT
--      scoped, no update/delete policy added.
--   4. Three security-definer RPCs in the submittal cluster had gaps of
--      the exact same class migration 155 found and fixed for proposals:
--        - create_and_send_submittal_version() -- checks role (PM/admin)
--          but never checks the caller's workspace against the target
--          project's workspace. Fixed using the same
--          resolve_caller_workspace_id() + explicit-comparison pattern
--          already proven in create_project_from_quote() (migration 146)
--          and request_or_send_quote_proposal_version() (migration 155).
--        - get_submittal_by_token() -- anon/token path, never checks
--          workspaces.status (T8-equivalent, confirmed still unfixed).
--        - respond_to_submittal() -- same T8-equivalent gap.
--      All three hardened below. create_and_send_submittal_version() and
--      respond_to_submittal() also had their settings-lookup's use of
--      active_workspace_id() (the "exactly one workspace in the whole
--      database" transitional guard, migration 124) replaced with the
--      already-resolved project's own workspace_id -- safe to fix now,
--      unlike the SHARED share-link RPCs (regenerate_share_link,
--      permanently_revoke_share_link), because these two functions are
--      submittal-only, not shared with proposals -- confirmed by direct
--      read of their full bodies, not assumed.
--   5. active_workspace_id() itself, and the SHARED share-link RPCs
--      (regenerate_share_link, permanently_revoke_share_link, and the
--      reissue/expiry paths in migrations 139/143/145/148/153 that
--      branch on entity_type between 'project_submittal' and
--      'sales_quote_proposal') are DELIBERATELY NOT touched by this
--      migration, even though both projects.workspace_id and
--      sales_quotes.workspace_id are now real and confirmed live. Fixing
--      shared code correctly needs its own focused pass (resolving
--      workspace_id conditionally per entity_type) with its own test --
--      queued as the very next migration (158), not bundled in here.
--
-- Preserves current authorized same-workspace behavior throughout: with
-- exactly one real workspace in production today, every policy below
-- evaluates to exactly the same true/false outcome the pre-existing
-- role-gated/using(true) logic already produced for every current real
-- user -- provable the same way migration 155's equivalent claim was
-- (migration 115's data migration put every current user into
-- workspace_members for the one active workspace).
--
-- Confirm 157 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- New owner-resolver helper functions. Same pattern as
-- migration 155's sales_quote_owner_workspace_id() etc. -- security
-- definer, read the target table under the OWNER's privileges, return
-- NULL (never raise) for a dangling/invalid id.
-- is_active_workspace_member() itself already exists (migration 155),
-- reused verbatim, not recreated.
-- ============================================================

create or replace function public.project_owner_workspace_id(p_project_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.projects where id = p_project_id;
$$;

create or replace function public.project_location_owner_workspace_id(p_project_location_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select p.workspace_id
  from public.project_locations l
  join public.projects p on p.id = l.project_id
  where l.id = p_project_location_id;
$$;

create or replace function public.task_owner_workspace_id(p_task_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.tasks where id = p_task_id;
$$;

revoke execute on function public.project_owner_workspace_id(uuid) from public;
revoke execute on function public.project_location_owner_workspace_id(uuid) from public;
revoke execute on function public.task_owner_workspace_id(uuid) from public;
grant execute on function public.project_owner_workspace_id(uuid) to authenticated;
grant execute on function public.project_location_owner_workspace_id(uuid) to authenticated;
grant execute on function public.task_owner_workspace_id(uuid) to authenticated;

-- ============================================================
-- Section 2 -- projects: read scoped to workspace; write keeps its
-- existing pm/admin role gate, ANDed with the new workspace check, not
-- replaced.
-- ============================================================

drop policy if exists "authenticated read projects" on public.projects;
drop policy if exists "pm and admin write projects" on public.projects;

create policy "workspace members read projects"
  on public.projects for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: pm and admin insert projects"
  on public.projects for insert to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

create policy "workspace members: pm and admin update projects"
  on public.projects for update to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

create policy "workspace members: pm and admin delete projects"
  on public.projects for delete to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

-- ============================================================
-- Section 3 -- tasks: full replace, no role gate (matches its existing
-- fully-open shape, never touched since migration 015).
-- ============================================================

drop policy if exists "authenticated read tasks" on public.tasks;
drop policy if exists "authenticated write tasks" on public.tasks;

create policy "workspace members read tasks"
  on public.tasks for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members insert tasks"
  on public.tasks for insert to authenticated
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members update tasks"
  on public.tasks for update to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members delete tasks"
  on public.tasks for delete to authenticated
  using (public.is_active_workspace_member(workspace_id));

-- ============================================================
-- Section 4 -- one-level project children, no role gate (project_locations,
-- project_handovers, project_stakeholders, installed_assets).
-- ============================================================

drop policy if exists "authenticated read project_locations" on public.project_locations;
drop policy if exists "authenticated write project_locations" on public.project_locations;

create policy "workspace members read project_locations"
  on public.project_locations for select to authenticated
  using (public.is_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members insert project_locations"
  on public.project_locations for insert to authenticated
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members update project_locations"
  on public.project_locations for update to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)))
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members delete project_locations"
  on public.project_locations for delete to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

drop policy if exists "authenticated read project_handovers" on public.project_handovers;
drop policy if exists "authenticated write project_handovers" on public.project_handovers;

create policy "workspace members read project_handovers"
  on public.project_handovers for select to authenticated
  using (public.is_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members insert project_handovers"
  on public.project_handovers for insert to authenticated
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members update project_handovers"
  on public.project_handovers for update to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)))
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members delete project_handovers"
  on public.project_handovers for delete to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

drop policy if exists "authenticated read project_stakeholders" on public.project_stakeholders;
drop policy if exists "authenticated write project_stakeholders" on public.project_stakeholders;

create policy "workspace members read project_stakeholders"
  on public.project_stakeholders for select to authenticated
  using (public.is_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members insert project_stakeholders"
  on public.project_stakeholders for insert to authenticated
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members update project_stakeholders"
  on public.project_stakeholders for update to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)))
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members delete project_stakeholders"
  on public.project_stakeholders for delete to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

drop policy if exists "authenticated read installed_assets" on public.installed_assets;
drop policy if exists "authenticated write installed_assets" on public.installed_assets;

create policy "workspace members read installed_assets"
  on public.installed_assets for select to authenticated
  using (public.is_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members insert installed_assets"
  on public.installed_assets for insert to authenticated
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members update installed_assets"
  on public.installed_assets for update to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)))
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members delete installed_assets"
  on public.installed_assets for delete to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

-- ============================================================
-- Section 5 -- one-level project children WITH the pm/admin role gate
-- (project_scope_of_work, project_bom_lines) -- both narrowed by
-- migration 023, same "alongside, not instead of" treatment as
-- `projects` itself in Section 2.
-- ============================================================

drop policy if exists "authenticated read project_scope_of_work" on public.project_scope_of_work;
drop policy if exists "pm and admin write project_scope_of_work" on public.project_scope_of_work;

create policy "workspace members read project_scope_of_work"
  on public.project_scope_of_work for select to authenticated
  using (public.is_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members: pm and admin insert project_scope_of_work"
  on public.project_scope_of_work for insert to authenticated
  with check (
    public.is_active_workspace_member(public.project_owner_workspace_id(project_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

create policy "workspace members: pm and admin update project_scope_of_work"
  on public.project_scope_of_work for update to authenticated
  using (
    public.is_active_workspace_member(public.project_owner_workspace_id(project_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  )
  with check (
    public.is_active_workspace_member(public.project_owner_workspace_id(project_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

create policy "workspace members: pm and admin delete project_scope_of_work"
  on public.project_scope_of_work for delete to authenticated
  using (
    public.is_active_workspace_member(public.project_owner_workspace_id(project_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

drop policy if exists "authenticated read project_bom_lines" on public.project_bom_lines;
drop policy if exists "pm and admin write project_bom_lines" on public.project_bom_lines;

create policy "workspace members read project_bom_lines"
  on public.project_bom_lines for select to authenticated
  using (public.is_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members: pm and admin insert project_bom_lines"
  on public.project_bom_lines for insert to authenticated
  with check (
    public.is_active_workspace_member(public.project_owner_workspace_id(project_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

create policy "workspace members: pm and admin update project_bom_lines"
  on public.project_bom_lines for update to authenticated
  using (
    public.is_active_workspace_member(public.project_owner_workspace_id(project_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  )
  with check (
    public.is_active_workspace_member(public.project_owner_workspace_id(project_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

create policy "workspace members: pm and admin delete project_bom_lines"
  on public.project_bom_lines for delete to authenticated
  using (
    public.is_active_workspace_member(public.project_owner_workspace_id(project_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

-- ============================================================
-- Section 6 -- project_submittals: SELECT only. No insert/update/delete
-- policy is added -- none has existed since migration 144, and adding
-- one now would grant a write capability that does not exist today.
-- ============================================================

drop policy if exists "authenticated read project_submittals" on public.project_submittals;

create policy "workspace members read project_submittals"
  on public.project_submittals for select to authenticated
  using (public.is_workspace_member(public.project_owner_workspace_id(project_id)));

-- ============================================================
-- Section 7 -- two-level children (project_location_id -> project_locations
-- -> projects): project_location_images, project_location_items.
-- ============================================================

drop policy if exists "authenticated read project_location_images" on public.project_location_images;
drop policy if exists "authenticated write project_location_images" on public.project_location_images;

create policy "workspace members read project_location_images"
  on public.project_location_images for select to authenticated
  using (public.is_workspace_member(public.project_location_owner_workspace_id(project_location_id)));

create policy "workspace members insert project_location_images"
  on public.project_location_images for insert to authenticated
  with check (public.is_active_workspace_member(public.project_location_owner_workspace_id(project_location_id)));

create policy "workspace members update project_location_images"
  on public.project_location_images for update to authenticated
  using (public.is_active_workspace_member(public.project_location_owner_workspace_id(project_location_id)))
  with check (public.is_active_workspace_member(public.project_location_owner_workspace_id(project_location_id)));

create policy "workspace members delete project_location_images"
  on public.project_location_images for delete to authenticated
  using (public.is_active_workspace_member(public.project_location_owner_workspace_id(project_location_id)));

drop policy if exists "authenticated read project_location_items" on public.project_location_items;
drop policy if exists "authenticated write project_location_items" on public.project_location_items;

create policy "workspace members read project_location_items"
  on public.project_location_items for select to authenticated
  using (public.is_workspace_member(public.project_location_owner_workspace_id(project_location_id)));

create policy "workspace members insert project_location_items"
  on public.project_location_items for insert to authenticated
  with check (public.is_active_workspace_member(public.project_location_owner_workspace_id(project_location_id)));

create policy "workspace members update project_location_items"
  on public.project_location_items for update to authenticated
  using (public.is_active_workspace_member(public.project_location_owner_workspace_id(project_location_id)))
  with check (public.is_active_workspace_member(public.project_location_owner_workspace_id(project_location_id)));

create policy "workspace members delete project_location_items"
  on public.project_location_items for delete to authenticated
  using (public.is_active_workspace_member(public.project_location_owner_workspace_id(project_location_id)));

-- ============================================================
-- Section 8 -- task children. task_hardware_dependencies: full replace,
-- no role gate. task_activity_log: SELECT + INSERT only, no update/
-- delete policy added -- preserves its existing append-only shape
-- exactly (never had one since migration 036).
-- ============================================================

drop policy if exists "authenticated read task_hardware_dependencies" on public.task_hardware_dependencies;
drop policy if exists "authenticated write task_hardware_dependencies" on public.task_hardware_dependencies;

create policy "workspace members read task_hardware_dependencies"
  on public.task_hardware_dependencies for select to authenticated
  using (public.is_workspace_member(public.task_owner_workspace_id(task_id)));

create policy "workspace members insert task_hardware_dependencies"
  on public.task_hardware_dependencies for insert to authenticated
  with check (public.is_active_workspace_member(public.task_owner_workspace_id(task_id)));

create policy "workspace members update task_hardware_dependencies"
  on public.task_hardware_dependencies for update to authenticated
  using (public.is_active_workspace_member(public.task_owner_workspace_id(task_id)))
  with check (public.is_active_workspace_member(public.task_owner_workspace_id(task_id)));

create policy "workspace members delete task_hardware_dependencies"
  on public.task_hardware_dependencies for delete to authenticated
  using (public.is_active_workspace_member(public.task_owner_workspace_id(task_id)));

drop policy if exists "authenticated read task_activity_log" on public.task_activity_log;
drop policy if exists "authenticated insert task_activity_log" on public.task_activity_log;

create policy "workspace members read task_activity_log"
  on public.task_activity_log for select to authenticated
  using (public.is_workspace_member(public.task_owner_workspace_id(task_id)));

create policy "workspace members insert task_activity_log"
  on public.task_activity_log for insert to authenticated
  with check (public.is_active_workspace_member(public.task_owner_workspace_id(task_id)));

-- ============================================================
-- Section 9 -- RPC hardening. Every function below is security definer
-- and therefore bypasses every policy created above by definition.
-- Signatures are unchanged for all three, so CREATE OR REPLACE is safe
-- -- no drop-then-create and no frontend change needed.
-- ============================================================

-- get_submittal_by_token: adds a suspended-workspace check, mapped to
-- the same 'unavailable' outcome already used for a disabled/revoked
-- link (T8-equivalent) -- an external client sees no difference
-- between "this link was disabled" and "this company's workspace is
-- suspended". The project join already exists (needed for
-- p.project_name) -- p.workspace_id is read from that same row, no new
-- join added. Every other branch, and the view-logging insert, is
-- copied verbatim from the current live definition (migration 145).
create or replace function public.get_submittal_by_token(share_token text)
returns table (
  outcome text,
  submittal_id uuid,
  status text,
  version integer,
  content_snapshot jsonb,
  client_name text,
  project_name text,
  responded_at timestamptz,
  approval_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_status text;
  v_expires_at timestamptz;
  v_id uuid;
  v_status text;
  v_version integer;
  v_content_snapshot jsonb;
  v_client_name text;
  v_project_name text;
  v_responded_at timestamptz;
  v_approval_name text;
  v_outcome text;
  v_view_result text;
  v_workspace_status text;
begin
  select t.status, t.expires_at, s.id, s.status, s.version, s.content_snapshot, s.client_name, p.project_name, s.responded_at, s.approval_name, w.status
  into v_token_status, v_expires_at, v_id, v_status, v_version, v_content_snapshot, v_client_name, v_project_name, v_responded_at, v_approval_name, v_workspace_status
  from public.public_share_tokens t
  join public.project_submittals s on s.id = t.entity_id
  join public.projects p on p.id = s.project_id
  join public.workspaces w on w.id = p.workspace_id
  where t.token = share_token and t.entity_type = 'project_submittal';

  if v_token_status is null then
    return query select 'invalid_token'::text, null::uuid, null::text, null::integer, null::jsonb, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;

  if v_token_status = 'superseded' then
    v_outcome := 'superseded';
    v_view_result := 'superseded';
  elsif v_token_status = 'temporarily_disabled' then
    v_outcome := 'unavailable';
    v_view_result := 'disabled';
  elsif v_token_status = 'permanently_revoked' then
    v_outcome := 'unavailable';
    v_view_result := 'revoked';
  elsif v_expires_at is not null and v_expires_at <= now() then
    v_outcome := 'expired';
    v_view_result := 'expired';
  elsif coalesce(v_workspace_status, 'active') <> 'active' then
    v_outcome := 'unavailable';
    v_view_result := 'disabled';
  else
    v_outcome := 'found';
    v_view_result := 'success';
  end if;

  begin
    insert into public.share_link_views (token, entity_type, entity_id, result)
    values (share_token, 'project_submittal', v_id, v_view_result);
  exception when others then
    null;
  end;

  if v_outcome <> 'found' then
    return query select v_outcome, null::uuid, null::text, null::integer, null::jsonb, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;

  return query select 'found'::text, v_id, v_status, v_version, v_content_snapshot, v_client_name, v_project_name, v_responded_at, v_approval_name;
end;
$$;

-- Grant posture re-stated explicitly (unchanged from migration 145) --
-- CREATE OR REPLACE preserves existing grants on its own, but restating
-- them here makes this migration's intended access posture
-- self-contained rather than silently relying on history.
revoke all on function public.get_submittal_by_token(text) from public;
revoke execute on function public.get_submittal_by_token(text) from authenticated;
grant execute on function public.get_submittal_by_token(text) to anon;

-- respond_to_submittal: same suspended-workspace guard as above, and
-- replaces the expiration-lookup's use of active_workspace_id() with
-- the target project's own already-resolved workspace_id -- safe here
-- specifically because this function is submittal-only, not shared
-- with proposals (confirmed by direct read of its full body). No other
-- logic changes from the current live definition (migration 139). Grant
-- posture unchanged -- still anon-callable, matching current production
-- behavior; tightening that grant is D12/e-signature-hardening scope,
-- not Phase 3 tenancy scope, and explicitly out of bounds here.
create or replace function public.respond_to_submittal(
  share_token text,
  new_status text,
  approver_name text,
  approver_ip text,
  notes text
)
returns table (
  outcome text,
  status text,
  responded_at timestamptz,
  approval_name text,
  version integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  target_project_id uuid;
  target_workspace_id uuid;
  target_workspace_status text;
  token_status text;
  token_expires_at timestamptz;
  updated_status text;
  updated_responded_at timestamptz;
  updated_approval_name text;
  updated_version integer;
  current_status text;
  current_responded_at timestamptz;
  current_approval_name text;
  current_version integer;
  project_label text;
  rule_active boolean;
  recipient record;
begin
  if new_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'Invalid submittal response status';
  end if;

  select t.status, t.expires_at, s.id, s.project_id
  into token_status, token_expires_at, target_id, target_project_id
  from public.public_share_tokens t
  join public.project_submittals s on s.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'project_submittal';

  if target_id is null then
    return query select 'invalid_token'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;

  select p.workspace_id into target_workspace_id
  from public.projects p where p.id = target_project_id;

  select w.status into target_workspace_status
  from public.workspaces w where w.id = target_workspace_id;

  if token_status = 'superseded' then
    return query select 'superseded'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;
  if token_status in ('temporarily_disabled', 'permanently_revoked') then
    return query select 'unavailable'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;
  if token_expires_at is not null and token_expires_at <= now() then
    return query select 'expired'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;
  if coalesce(target_workspace_status, 'active') <> 'active' then
    return query select 'unavailable'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;

  update public.project_submittals as ps
  set status = new_status,
      responded_at = now(),
      response_notes = notes,
      approval_name = approver_name,
      approval_ip = approver_ip,
      approval_content_hash = encode(sha256(ps.content_snapshot::text::bytea), 'hex'),
      updated_at = now()
  where ps.id = target_id
    and ps.status = 'sent'
  returning ps.status, ps.responded_at, ps.approval_name, ps.version
  into updated_status, updated_responded_at, updated_approval_name, updated_version;

  if updated_status is null then
    select ps.status, ps.responded_at, ps.approval_name, ps.version
    into current_status, current_responded_at, current_approval_name, current_version
    from public.project_submittals as ps
    where ps.id = target_id;

    return query select 'already_responded'::text, current_status, current_responded_at, current_approval_name, current_version;
    return;
  end if;

  begin
    update public.public_share_tokens
    set expires_at = now() + (
      select default_expiration_completed_documents from public.workspace_share_link_settings
      where workspace_id = target_workspace_id
    )
    where token = share_token;
  exception when others then
    null;
  end;

  select p.project_name into project_label from public.projects p where p.id = target_project_id;

  select is_active into rule_active from public.notification_rules where event_type = 'submittal_responded';

  if coalesce(rule_active, false) then
    for recipient in
      select email from public.get_users_by_role('pm')
      union
      select email from public.get_admin_emails()
    loop
      insert into public.notifications (recipient_email, event_type, title, body, related_entity_type, related_entity_id, dedupe_key)
      values (
        recipient.email,
        'submittal_responded',
        'Submittal ' || replace(new_status, '_', ' '),
        coalesce(project_label, 'A project') || ' submittal v' || updated_version || ' was ' || replace(new_status, '_', ' ') || ' by ' || coalesce(approver_name, 'the client') || '.',
        'project_submittal',
        target_id::text,
        'submittal_responded:' || target_id::text || ':' || new_status || ':' || recipient.email
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end loop;
  end if;

  return query select 'success'::text, updated_status, updated_responded_at, updated_approval_name, updated_version;
end;
$$;

revoke all on function public.respond_to_submittal(text, text, text, text, text) from public;
revoke execute on function public.respond_to_submittal(text, text, text, text, text) from authenticated;
grant execute on function public.respond_to_submittal(text, text, text, text, text) to anon;

-- create_and_send_submittal_version: adds an explicit caller-workspace-
-- vs-project-workspace check, using the exact same
-- resolve_caller_workspace_id() + comparison pattern already proven in
-- create_project_from_quote() (migration 146) and
-- request_or_send_quote_proposal_version() (migration 155). This
-- function is directly callable by authenticated PM/admin users (no
-- gate wrapper, unlike proposals' discount-approval gate), so the check
-- is placed immediately after the existing role check and project
-- lookup, before anything else runs. Also replaces the settings-lookup's
-- use of active_workspace_id() with the project's own already-resolved
-- workspace_id -- safe here for the same submittal-only reason given
-- for respond_to_submittal above.
create or replace function public.create_and_send_submittal_version(
  p_project_id uuid,
  p_content_snapshot jsonb,
  p_client_name text,
  p_client_email text
)
returns table (submittal_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_version integer;
  v_submittal_id uuid;
  v_token text;
  v_default_expiration interval;
  v_actor_email text;
  v_caller_workspace_id uuid;
  v_project_workspace_id uuid;
  r record;
begin
  if not (public.is_app_admin(auth.uid()) or public.has_role('pm')) then
    raise exception 'Only a PM or admin may create and send a submittal version.' using errcode = 'EC001';
  end if;

  select workspace_id into v_project_workspace_id from public.projects where id = p_project_id;
  if not found then
    raise exception 'This project could not be found.' using errcode = 'EC003';
  end if;

  -- Phase 3 containment: same EC002 convention as
  -- request_or_send_quote_proposal_version() (migration 155) and
  -- create_project_from_quote() (migration 146) for an identical
  -- cross-workspace-attempt case.
  v_caller_workspace_id := public.resolve_caller_workspace_id();
  if v_project_workspace_id is distinct from v_caller_workspace_id then
    raise exception 'This project does not belong to your workspace.' using errcode = 'EC002';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.project_submittals where project_id = p_project_id;

  insert into public.project_submittals (project_id, version, status, content_snapshot, client_name, client_email, sent_at)
  values (p_project_id, v_next_version, 'sent', coalesce(p_content_snapshot, '{}'::jsonb), p_client_name, p_client_email, now())
  returning id into v_submittal_id;

  select default_expiration_open_documents into v_default_expiration
  from public.workspace_share_link_settings
  where workspace_id = v_project_workspace_id;

  v_token := public.generate_share_token();
  v_actor_email := (select email from auth.users where id = auth.uid());

  insert into public.public_share_tokens (token, entity_type, entity_id, expires_at)
  values (
    v_token, 'project_submittal', v_submittal_id,
    case when v_default_expiration is not null then now() + v_default_expiration else null end
  );

  insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email)
  values (v_token, 'project_submittal', v_submittal_id, 'created', auth.uid(), v_actor_email);

  for r in
    select t.token as old_token, t.entity_id as old_entity_id
    from public.public_share_tokens t
    join public.project_submittals s on s.id = t.entity_id
    where t.entity_type = 'project_submittal'
      and s.project_id = p_project_id
      and s.id <> v_submittal_id
      and t.status in ('active', 'temporarily_disabled')
  loop
    update public.public_share_tokens as pst
    set status = 'superseded', superseded_by_token = v_token
    where pst.token = r.old_token;

    insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email)
    values (r.old_token, 'project_submittal', r.old_entity_id, 'superseded', auth.uid(), v_actor_email);
  end loop;

  return query select v_submittal_id, v_token;
end;
$$;

revoke all on function public.create_and_send_submittal_version(uuid, jsonb, text, text) from public;
revoke execute on function public.create_and_send_submittal_version(uuid, jsonb, text, text) from anon;
grant execute on function public.create_and_send_submittal_version(uuid, jsonb, text, text) to authenticated;

commit;

-- ============================================================
-- Deliberately NOT done by this migration:
--   - active_workspace_id() itself, and the SHARED share-link RPCs
--     (regenerate_share_link, permanently_revoke_share_link, and the
--     reissue/expiry paths that branch on entity_type between
--     'project_submittal' and 'sales_quote_proposal') -- see this file's
--     header. Queued as migration 158, the next automatic task.
--   - project_conversion_receipts -- already maximally locked down by
--     deliberate permanent design (migration 127); touching it would
--     only make it LESS restrictive.
--   - Storage bucket policies -- a separate, later phase, matching
--     migration 155's own deferral of sales-quote-images.
--   - Tightening respond_to_submittal's anon grant to match
--     respond_to_quote_proposal's service-role-only posture (migration
--     153) -- that is D12/e-signature-hardening scope, not Phase 3
--     tenancy scope. Not touched here.
-- ============================================================
