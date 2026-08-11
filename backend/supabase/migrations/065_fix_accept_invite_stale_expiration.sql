-- Bug fix: accept_invite's ON CONFLICT branch re-approved an existing
-- app_user_status row (approval_status='approved', approved_at=now()) but
-- never touched expires_at. Anyone accepting a brand-new invite who already
-- had an app_user_status row from before (an earlier partial sign-up, or an
-- earlier time-boxed approval that had lapsed) inherited whatever stale,
-- already-past expires_at was on that old row -- so accepting a fresh
-- invite could immediately show "Access expired" instead of granting
-- access. This is what happened to Nate: he was added to the roster (and
-- had some earlier sign-in attempt) before the invite system existed, so by
-- the time a real invite was sent and accepted, his existing app_user_status
-- row already had a past expires_at that the accept flow never cleared.
--
-- Fix: accepting an invite always clears expires_at (a fresh invite means
-- full access, not "whatever expiration happened to already be sitting on
-- the row"). An admin can still time-box the account afterward from the
-- Admin page as before.
create or replace function accept_invite(lookup_token text)
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
end;
$$;
