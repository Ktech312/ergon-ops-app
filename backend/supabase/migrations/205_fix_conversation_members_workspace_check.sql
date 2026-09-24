-- Migration 205: fix a real bug in migration 203 (already applied), found live 2026-09-24
-- running its own canonical test: `ERROR: 42703: column "status" of relation "workspace_members"
-- does not exist`. Two functions in migration 203 checked `wm.status = 'active'` directly on
-- `workspace_members` -- that table has no `status` column at all (confirmed from its real
-- create table, migration 115: id/workspace_id/user_id/is_workspace_admin/created_at/updated_at,
-- nothing else). "Active" membership is a property of the WORKSPACE, not the membership row --
-- `workspaces.status = 'active'`, reached via a join, exactly as `is_active_workspace_member()`
-- and migration 187's own `guard_conversation_workspace_id_mutation()` both already do
-- correctly. This was a transcription error writing migration 203 -- the correct join-to-
-- workspaces pattern existed right there in 187's own function in the same file and was not
-- followed precisely for these two new ones.
--
-- Per this repo's standing rule, migration 203 itself is NOT edited or rerun -- both affected
-- functions are corrected forward here via `create or replace function`, identical in every
-- other respect.

begin;

create or replace function public.guard_conversation_member_workspace_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv_workspace_id uuid;
begin
  select workspace_id into conv_workspace_id from public.conversations where id = new.conversation_id;
  if conv_workspace_id is null then
    raise exception 'Conversation not found.';
  end if;
  if not exists (
    select 1 from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.user_id = new.user_id and wm.workspace_id = conv_workspace_id and w.status = 'active'
  ) then
    raise exception 'Cannot add a member who is not an active member of this conversation''s workspace.';
  end if;
  return new;
end;
$$;

create or replace function public.create_group_conversation(p_title text, p_member_user_ids uuid[])
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_workspace_id uuid;
  v_conversation public.conversations;
  v_member_id uuid;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to start a group conversation';
  end if;
  if p_member_user_ids is null or array_length(p_member_user_ids, 1) is null or array_length(p_member_user_ids, 1) < 2 then
    raise exception 'A group conversation needs at least 2 other members';
  end if;

  v_actor_workspace_id := public.resolve_caller_workspace_id();

  foreach v_member_id in array p_member_user_ids loop
    if not exists (
      select 1 from public.workspace_members wm
      join public.workspaces w on w.id = wm.workspace_id
      where wm.user_id = v_member_id and wm.workspace_id = v_actor_workspace_id and w.status = 'active'
    ) then
      raise exception 'Every member must be an active member of your own workspace.';
    end if;
  end loop;

  insert into public.conversations (is_group, title, created_by, participant_a_id, participant_b_id)
  values (true, nullif(btrim(coalesce(p_title, '')), ''), v_actor_id, null, null)
  returning * into v_conversation;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_conversation.id, v_actor_id)
  on conflict (conversation_id, user_id) do nothing;

  foreach v_member_id in array p_member_user_ids loop
    insert into public.conversation_members (conversation_id, user_id)
    values (v_conversation.id, v_member_id)
    on conflict (conversation_id, user_id) do nothing;
  end loop;

  return v_conversation;
end;
$$;

revoke all on function public.create_group_conversation(text, uuid[]) from public;
revoke execute on function public.create_group_conversation(text, uuid[]) from anon;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

commit;
