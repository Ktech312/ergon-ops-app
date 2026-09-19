-- Phase 3 final scoping pass -- E confirmed "fix it now": a brand-new
-- user who accepts an invite today is approved into the app but has NO
-- workspace_members row, and thus cannot see ANY workspace-scoped data,
-- until an admin separately performs the unrelated "set primary role"
-- action from the Admin UI. This is a real, currently-live functional
-- gap, not future-proofing.
--
-- Re-confirmed directly from source before writing this, not from
-- memory or from any planning doc:
--
--   1. `user_invites` (backend/supabase/migrations/041_user_invites.sql:
--      17-30) has columns id, token, email, full_name, primary_role,
--      secondary_roles, invited_by_email, status, accepted_at,
--      accepted_user_id, created_at, expires_at -- NO workspace_id
--      column at all. Its RLS (041:35-41) is a single `for all` policy
--      gated only on `is_app_admin(auth.uid())` -- a global platform-
--      admin flag, no workspace concept whatsoever. Once a second
--      workspace exists, any global admin can read/create/revoke every
--      OTHER company's pending invites (emails, roles, tokens).
--   2. `accept_invite()`'s current, live body (read from
--      backend/supabase/migrations/065_fix_accept_invite_stale_expiration.sql,
--      the latest of the two migrations that touch this function --
--      grepped, no migration after 065 redefines it) writes to
--      `app_user_roles` and `app_user_status` only. It never inserts
--      into `workspace_members`.
--   3. The ONLY code path anywhere in this app that inserts a
--      `workspace_members` row for a non-bootstrap user is
--      `bridge_set_primary_role()` (backend/supabase/migrations/
--      124_workspace_authorization_bridge.sql:151-158), triggered when
--      an admin manually sets someone's primary role from the Admin UI
--      (src/persistence.ts:986 setPrimaryUserRole). It inserts with
--      `is_workspace_admin = false` (124:155-157) -- confirmed this is
--      the safe default for a non-explicitly-promoted user, reused
--      below.
--   4. Frontend: src/main.tsx:2951-2989 (admin "Invite a teammate" UI),
--      src/persistence.ts:1077 loadInvites, :1094 createInvite (a plain
--      PostgREST POST to `user_invites` -- never sends workspace_id
--      today, so the new server-side trigger added below stamps it
--      with no frontend change needed), :1122 revokeInvite (PATCH,
--      already has a row-count check per this session's established
--      "verify writes affected rows" discipline -- unaffected by this
--      migration, since a permission-blocked PATCH already reads as 0
--      rows changed), :1155 fetchInviteByToken (RPC get_invite_by_token,
--      anon-safe), :1196 acceptInvite (RPC accept_invite). Public accept
--      flow: src/main.tsx:27436+ (pre-login `?invite=<token>` landing
--      page). CONFIRMED: none of these need a frontend change --
--      createInvite/acceptInvite already just pass through to the RPCs/
--      table whose behavior changes server-side only in this migration.
--   5. `get_invite_by_token()` (041:48-64) is read-only, `security
--      definer`, and returns only email/full_name/primary_role/
--      secondary_roles/status -- it never touches workspace_id or any
--      workspace-scoped table. CONFIRMED no change needed.
--   6. `workspace_members`' only natural conflict target is its
--      `unique (workspace_id, user_id)` constraint (backend/supabase/
--      migrations/115_workspaces_foundation.sql:39-47) -- used as the
--      `on conflict` target below.
--
-- Fix, same root-table pattern as every other Stage 1-5 rollout this
-- session (migrations 173/175/176/177/178):
--
--   Section 1-2: add `user_invites.workspace_id`, backfill, lock NOT
--   NULL (same 4-step shape as migration 173/178).
--   Section 3: `guard_workspace_id_mutation()` (migration 117) reused
--   verbatim as a before-insert-or-update trigger -- derives
--   workspace_id from whichever admin is creating the invite via
--   `resolve_caller_workspace_id()`, exactly like every other root
--   table with no existing anchor to derive from instead.
--   Section 4: RLS -- `is_app_admin(auth.uid())` is kept as an
--   independent, ADDITIONAL requirement (ANDed, never replaced) rather
--   than swapped for a workspace-role check. This preserves today's
--   exact admin-gating behavior while adding workspace containment --
--   the safest minimal change. JUDGMENT CALL, flagged for E: whether
--   `is_app_admin` is meant as a global "Ergon Ops staff" flag or a
--   per-company admin flag is not resolvable from source alone --
--   preserving it unchanged (AND, not OR, not replaced) is correct
--   either way, so that ambiguity is deliberately not resolved here.
--   Section 5: `accept_invite()` rewritten via `create or replace
--   function` -- 065's existing app_user_roles/app_user_status logic is
--   carried forward byte-for-byte (read from source, not guessed), with
--   one addition: a `workspace_members` insert keyed off the invite's
--   OWN `workspace_id` column (not `resolve_caller_workspace_id()` --
--   the accepting caller is the brand-new invitee themselves, not an
--   admin, so the invite record is the only authoritative source of
--   which workspace they're joining), `is_workspace_admin = false`
--   (matching bridge_set_primary_role's own default for a non-
--   explicitly-promoted user), `on conflict (workspace_id, user_id) do
--   nothing` (in case an admin already added them some other way, e.g.
--   the existing bridge_set_primary_role path, before they accepted).
--   Function stays `security definer` (already required today to write
--   app_user_roles/app_user_status as a low-privilege authenticated
--   caller -- unchanged, still required to write workspace_members
--   under the same caller).
--
-- Confirm 181 is still the next free migration number at execution
-- time (a concurrent, unrelated migration 180 for a storage-bucket fix
-- was being drafted at the same time this file was written -- if it has
-- since landed, or if any other migration has, re-check the highest
-- number on disk before applying). Not applied. Kept local for E's
-- review.

begin;

-- ============================================================
-- Section 1 -- Schema: nullable for now, backfilled below, then locked
-- down NOT NULL in this same transaction (same three-step shape as
-- every other Stage 1-5 workspace_id rollout).
-- ============================================================

alter table public.user_invites
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_user_invites_workspace_id on public.user_invites(workspace_id);

-- ============================================================
-- Section 2 -- Backfill. user_invites has no anchor of its own (it is
-- the root of its own domain) -- fall back directly to this database's
-- one existing workspace, same pattern as every other Stage 1-5
-- backfill with no better anchor available.
-- ============================================================

update public.user_invites
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

do $$
begin
  if exists (select 1 from public.user_invites where workspace_id is null) then
    raise exception 'backfill incomplete: user_invites.workspace_id still has nulls';
  end if;
end $$;

alter table public.user_invites alter column workspace_id set not null;

-- ============================================================
-- Section 3 -- Ownership trigger: guard_workspace_id_mutation()
-- (migration 117), verbatim, same as every other root table with no
-- anchor to derive from instead.
-- ============================================================

drop trigger if exists user_invites_guard_workspace_id on public.user_invites;
create trigger user_invites_guard_workspace_id
  before insert or update on public.user_invites
  for each row execute function public.guard_workspace_id_mutation();

-- ============================================================
-- Section 4 -- RLS: workspace-scoped, ANDed with the existing
-- is_app_admin gate (never replaced -- see the judgment-call note in
-- the header comment above). Split into a read policy and a write
-- policy, same shape as migrations 173/175/176/177/178: read does not
-- require the workspace to be active (a suspended workspace's own
-- admins can still see their own pending invites), write does.
-- ============================================================

drop policy if exists "admins manage user_invites" on public.user_invites;

create policy "workspace members: admins read user_invites"
  on public.user_invites for select to authenticated
  using (
    public.is_app_admin(auth.uid())
    and public.is_workspace_member(workspace_id)
  );

create policy "workspace members: admins write user_invites"
  on public.user_invites for all to authenticated
  using (
    public.is_app_admin(auth.uid())
    and public.is_active_workspace_member(workspace_id)
  )
  with check (
    public.is_app_admin(auth.uid())
    and public.is_active_workspace_member(workspace_id)
  );

-- ============================================================
-- Section 5 -- accept_invite(): existing app_user_roles/app_user_status
-- logic carried forward VERBATIM from migration 065 (the current live
-- body). The only change is the new workspace_members insert, using the
-- invite's own workspace_id (not resolve_caller_workspace_id() -- the
-- caller here is the brand-new invitee, not an admin with an existing
-- membership to resolve). security definer is unchanged/required, same
-- as before this migration.
-- ============================================================

create or replace function public.accept_invite(lookup_token text)
returns void
language plpgsql
security definer
as $$
declare
  invite_row user_invites;
  calling_user uuid := auth.uid();
  secondary_role text;
begin
  if calling_user is null then
    raise exception 'Must be signed in to accept an invite';
  end if;

  select * into invite_row
  from user_invites
  where token = lookup_token
    and status = 'pending'
    and expires_at > now()
  for update;

  if invite_row.id is null then
    raise exception 'Invite not found, already used, or expired';
  end if;

  update user_invites
  set status = 'accepted', accepted_at = now(), accepted_user_id = calling_user
  where id = invite_row.id;

  delete from app_user_roles
  where user_id = calling_user and is_primary = true and role_key <> invite_row.primary_role;

  insert into app_user_roles (user_id, role_key, is_primary)
  values (calling_user, invite_row.primary_role, true)
  on conflict (user_id, role_key) do update set is_primary = true;

  foreach secondary_role in array invite_row.secondary_roles loop
    insert into app_user_roles (user_id, role_key, is_primary)
    values (calling_user, secondary_role, false)
    on conflict (user_id, role_key) do nothing;
  end loop;

  insert into app_user_status (user_id, approval_status, approved_at, requested_at, expires_at)
  values (calling_user, 'approved', now(), now(), null)
  on conflict (user_id) do update set approval_status = 'approved', approved_at = now(), expires_at = null;

  -- NEW: the accepting user joins the invite's own workspace as a
  -- regular (non-admin) member. This is the fix this migration exists
  -- for -- previously nothing, anywhere, gave a newly-accepted invitee
  -- a workspace_members row. on conflict do nothing covers the case
  -- where an admin already added them some other way (e.g.
  -- bridge_set_primary_role) before they got around to accepting.
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
  values (invite_row.workspace_id, calling_user, false)
  on conflict (workspace_id, user_id) do nothing;
end;
$$;

commit;
