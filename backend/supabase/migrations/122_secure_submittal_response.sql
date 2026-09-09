-- Fixes the submittal-response equivalent of migration 119's proposal
-- fix, per E's explicit follow-up instruction. Two confirmed bugs, both
-- present since the functions' original definitions:
--
-- Bug 1 -- no status-transition guard (migration 025's original
-- respond_to_submittal()). `update project_submittals set status = ...
-- where id = target_id;` has no `and status = 'sent'` precondition, so
-- the same share token can be replayed to silently overwrite an
-- already-approved/rejected/revision-requested submittal's recorded
-- outcome. Same class of bug as PRODUCT_TOKEN_BACKUP_CONTENT_TEST_AUDIT.md
-- Part A3, fixed for proposals in migrations 119/121.
--
-- Bug 2 -- ON CONFLICT arbiter mismatch (migration 055's notification
-- patch), present since that migration shipped. `on conflict
-- (dedupe_key) do nothing` never matched notifications' real unique
-- index, which is PARTIAL: `create unique index idx_notifications_dedupe
-- on notifications(dedupe_key) where dedupe_key is not null` (migration
-- 024). Same 42P10 class as the bug found and fixed in migration 121.
-- Migration 055's own header comment says this notification code exists
-- specifically because no submittal_responded notification had ever
-- fired before -- combined with this bug, no submittal response has
-- ever successfully notified a PM or admin since 055 shipped.
--
-- Fix shape mirrors 119/121 exactly: an atomic `update ... where status
-- = 'sent'` (safe against concurrent responses under Postgres's own
-- MVCC/row-locking, same reasoning as 119's own header comment), a
-- structured (outcome, status, responded_at, approval_name, version)
-- return instead of void, notification insert only on the winning
-- transition, `security definer` + `search_path=''` + fully
-- schema-qualified, and `RETURNS TABLE` columns aliased/qualified
-- throughout to avoid the ambiguous-column bug found live during
-- migration 119's own verification (Postgres 42702) -- designed in from
-- the start here instead of discovered after the fact.
--
-- Recipients are UNCHANGED: every user holding the 'pm' role
-- (get_users_by_role('pm')) unioned with every admin (get_admin_emails())
-- -- the same two pre-existing functions migration 055 already called,
-- called here identically, just schema-qualified. Not touching who gets
-- notified, per explicit instruction.
--
-- Token expiration (expires_at never set) and revocation are
-- deliberately NOT touched -- same exclusion as migrations 119/121,
-- recorded as a separate, undiscussed product decision.
--
-- Uses migration number 122 -- 120 is reserved for the per-workspace
-- uniqueness plan (PRODUCT_PHASE2_PLAN.md Revision 6), 121 already
-- exists (the proposal-response bug fixes) -- not reused retroactively.

begin;

-- ============================================================
-- Section 1 -- get_submittal_by_token(): same query logic, now also
-- returns responded_at/approval_name (needed for the "already responded
-- on <date>" public-page wording, same as the proposal fix). Hardened.
-- Grant narrowed to anon only -- confirmed by re-reading persistence.ts:
-- fetchPublicSubmittal always calls with no access token, so every real
-- call resolves as anon; the original migration's `authenticated` grant
-- is unused by any code path found. Learning from migration 119's own
-- verification tonight: this Supabase project's schema-level default
-- privileges auto-grant EXECUTE to `authenticated` (and anon/service_role)
-- on any newly created function, independent of `revoke all ... from
-- public` -- so `authenticated` is explicitly revoked here too, from the
-- start, rather than found and fixed as a follow-up.
-- ============================================================

drop function if exists public.get_submittal_by_token(text);

create function public.get_submittal_by_token(share_token text)
returns table (
  submittal_id uuid,
  status text,
  version integer,
  content_snapshot jsonb,
  client_name text,
  project_name text,
  responded_at timestamptz,
  approval_name text
)
language sql
security definer
stable
set search_path = ''
as $$
  select s.id, s.status, s.version, s.content_snapshot, s.client_name, p.project_name, s.responded_at, s.approval_name
  from public.public_share_tokens t
  join public.project_submittals s on s.id = t.entity_id
  join public.projects p on p.id = s.project_id
  where t.token = share_token
    and t.entity_type = 'project_submittal'
    and (t.expires_at is null or t.expires_at > now());
$$;

revoke all on function public.get_submittal_by_token(text) from public;
revoke execute on function public.get_submittal_by_token(text) from authenticated;
grant execute on function public.get_submittal_by_token(text) to anon;

-- ============================================================
-- Section 2 -- respond_to_submittal(): the real fix. Same three-outcome
-- shape as respond_to_quote_proposal (migration 119/121):
--   'invalid_token'     -- token doesn't resolve to a live, unexpired
--                           submittal.
--   'already_responded' -- the conditional UPDATE matched zero rows
--                           because the submittal was no longer 'sent'.
--                           State fields come from a FRESH re-select
--                           after the failed UPDATE, never from an
--                           earlier pre-UPDATE read.
--   'success'            -- this call's UPDATE was the one that matched.
--                           State fields come from UPDATE ... RETURNING.
-- Notification loop only runs inside the 'success' branch -- a
-- concurrency loser or stale resubmission never reaches it.
-- ============================================================

drop function if exists public.respond_to_submittal(text, text, text, text, text);

create function public.respond_to_submittal(
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

  select s.id, s.project_id
  into target_id, target_project_id
  from public.public_share_tokens t
  join public.project_submittals s on s.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'project_submittal'
    and (t.expires_at is null or t.expires_at > now());

  if target_id is null then
    return query select 'invalid_token'::text, null::text, null::timestamptz, null::text, null::integer;
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
    -- Concurrency loser or stale resubmission. Re-read fresh -- never
    -- trust an earlier pre-UPDATE read for the same reason migration
    -- 119/121 documents.
    select ps.status, ps.responded_at, ps.approval_name, ps.version
    into current_status, current_responded_at, current_approval_name, current_version
    from public.project_submittals as ps
    where ps.id = target_id;

    return query select 'already_responded'::text, current_status, current_responded_at, current_approval_name, current_version;
    return;
  end if;

  -- Real, winning transition -- notify every intended recipient, exactly
  -- once each. Recipients unchanged from migration 055: every pm-role
  -- user unioned with every admin.
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

commit;

-- ============================================================
-- Deliberately NOT done by this migration, per explicit instruction:
--   - public_share_tokens.expires_at is still never set by any writer,
--     so submittal (and proposal) links still never actually expire in
--     practice. No default expiration period is introduced here.
--   - No token revocation mechanism is added.
--   - get_users_by_role()/get_admin_emails() themselves are not
--     re-hardened (they predate search_path=''/schema-qualification
--     too) -- out of scope for this narrow fix, called here exactly as
--     migration 055 already called them, just schema-qualified at the
--     call site.
-- All recorded, unresolved items -- not silently dropped.
-- ============================================================
