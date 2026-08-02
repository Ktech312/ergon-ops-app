-- Hardens the no-login MVP foundation without changing the current UI contract.
-- These tables support future normalized sync, document backup/storage references,
-- and transaction locking before stock-consuming actions.

create table if not exists app_sync_events (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null default 'default',
  event_type text not null check (event_type in ('snapshot_save', 'snapshot_load', 'normalized_write', 'import', 'export')),
  entity_type text not null,
  entity_ref text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists app_transaction_locks (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null default 'default',
  lock_key text not null,
  lock_type text not null check (lock_type in ('inventory_item', 'project', 'build', 'purchase_request')),
  owner_label text not null default 'browser-session',
  expires_at timestamptz not null default now() + interval '5 minutes',
  released_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_key, lock_key, lock_type)
);

alter table project_documents
  add column if not exists local_document_id text,
  add column if not exists project_name text,
  add column if not exists file_size_bytes bigint not null default 0,
  add column if not exists storage_status text not null default 'browser'
    check (storage_status in ('browser', 'google_drive', 'supabase_storage', 'archived')),
  add column if not exists drive_folder_url text,
  add column if not exists storage_path text;

create index if not exists idx_app_sync_events_workspace_created
  on app_sync_events(workspace_key, created_at desc);

create index if not exists idx_transaction_locks_active
  on app_transaction_locks(workspace_key, lock_type, lock_key)
  where released_at is null;

create index if not exists idx_project_documents_project_name
  on project_documents(project_name);

alter table app_sync_events enable row level security;
alter table app_transaction_locks enable row level security;

create policy "authenticated read app_sync_events"
  on app_sync_events for select to authenticated using (true);

create policy "authenticated write app_sync_events"
  on app_sync_events for all to authenticated using (true) with check (true);

create policy "authenticated read app_transaction_locks"
  on app_transaction_locks for select to authenticated using (true);

create policy "authenticated write app_transaction_locks"
  on app_transaction_locks for all to authenticated using (true) with check (true);

create policy "anon read app_sync_events during no-login MVP"
  on app_sync_events for select to anon using (true);

create policy "anon write app_sync_events during no-login MVP"
  on app_sync_events for all to anon using (true) with check (true);

create policy "anon read app_transaction_locks during no-login MVP"
  on app_transaction_locks for select to anon using (true);

create policy "anon write app_transaction_locks during no-login MVP"
  on app_transaction_locks for all to anon using (true) with check (true);
