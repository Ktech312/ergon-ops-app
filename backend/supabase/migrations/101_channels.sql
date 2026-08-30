-- Migration 101: group channels, phase 1 of the Slack/ClickUp/Drive
-- replacement roadmap (see HANDOFF.md "Long-term roadmap" for the full
-- design). E: "you can start with most of it."
--
-- Two channel types land in this migration: section channels (one fixed,
-- permanent channel per major app section) and project channels (one per
-- Project, auto-created, and -- the actual point of this whole effort --
-- never deleted when a project closes, so its history isn't lost the way
-- old Slack channels are today). Client channels are phase 4, once
-- clients exist as a real entity; not here.
--
-- One shared table for every channel type (rather than a separate table
-- per type) is what lets the embedded Discussion tabs and the future
-- Messages-hub rebuild be two views of the same data instead of two
-- features to maintain. channel_messages mirrors direct_messages'
-- shape (migration 094/100) on purpose, including attachments from day
-- one -- same upload/signed-URL code, just a different id prefix.
--
-- Visibility: broad "any authenticated user" RLS, matching team_members/
-- vendors/projects' own existing posture (migration 094's own comment:
-- "consistent with how team_members/vendors are already broadly readable
-- to any authenticated user on this small internal team"). Real
-- visibility is enforced the same way every other section in this app
-- already enforces it -- client-side tab access (allowedTabs) -- not a
-- new per-channel ACL system. This is deliberately different from direct
-- messages (migration 094/100), which stay strictly participant-scoped --
-- those are actually private 1:1s, these are team-visible by design.

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('section', 'project', 'client')),
  section_key text,
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (type, section_key),
  unique (type, project_id)
);

create table if not exists channel_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text,
  created_at timestamptz not null default now(),
  attachment_storage_path text,
  attachment_file_name text,
  attachment_mime_type text,
  attachment_size_bytes bigint,
  check ((body is not null and char_length(body) > 0) or attachment_storage_path is not null),
  check (body is null or char_length(body) <= 4000)
);

create index if not exists idx_channel_messages_channel on channel_messages(channel_id, created_at);

alter table channels enable row level security;
alter table channel_messages enable row level security;

drop policy if exists "authenticated read channels" on channels;
create policy "authenticated read channels" on channels for select to authenticated using (true);

drop policy if exists "authenticated write channels" on channels;
create policy "authenticated write channels" on channels for insert to authenticated with check (true);

drop policy if exists "authenticated read channel_messages" on channel_messages;
create policy "authenticated read channel_messages" on channel_messages for select to authenticated using (true);

drop policy if exists "authenticated send channel_messages" on channel_messages;
create policy "authenticated send channel_messages" on channel_messages for insert to authenticated with check (sender_id = auth.uid());

-- Seed the fixed section channels -- singletons, never created/deleted by
-- users. section_key values match the app's own View union (main.tsx).
insert into channels (type, section_key, name)
values
  ('section', 'inventory', 'Inventory & Purchasing'),
  ('section', 'projects', 'Projects'),
  ('section', 'sales', 'Sales'),
  ('section', 'marketing', 'Marketing')
on conflict (type, section_key) do nothing;

-- Auto-create a channel for every Project going forward.
create or replace function create_project_channel()
returns trigger as $$
begin
  insert into channels (type, project_id, name)
  values ('project', new.id, new.project_name)
  on conflict (type, project_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists projects_create_channel on projects;
create trigger projects_create_channel
  after insert on projects
  for each row execute function create_project_channel();

-- Backfill channels for every project that already exists.
insert into channels (type, project_id, name)
select 'project', id, project_name from projects
on conflict (type, project_id) do nothing;

-- Extend the private message-attachments bucket (migration 100) to also
-- accept channel-message uploads. The existing DM policies check the path
-- prefix against `conversations` (participant-scoped, stays as-is);
-- these are separate, additional policies (RLS policies of the same
-- command type OR together in Postgres -- same pattern migration 094
-- already uses for app_known_users) that check the prefix against
-- `channels` instead, broadly authenticated to match channels' own
-- visibility model.
drop policy if exists "authenticated read channel message-attachments" on storage.objects;
create policy "authenticated read channel message-attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and exists (select 1 from channels c where name like c.id::text || '/%')
  );

drop policy if exists "authenticated write channel message-attachments" on storage.objects;
create policy "authenticated write channel message-attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and exists (select 1 from channels c where name like c.id::text || '/%')
  );
