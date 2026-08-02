-- Production persistence and access hardening.
-- Moves the frontend away from one snapshot row and removes public anonymous
-- write/read policies created during early no-login testing.

create table if not exists app_records (
  workspace_key text not null default 'default',
  record_key text not null check (
    record_key in (
      'inventoryItems',
      'projectSites',
      'deviceRecipes',
      'inventoryMovements',
      'buildTransactions',
      'projectAllocations',
      'purchaseRequests',
      'projectDocuments',
      'roleMode'
    )
  ),
  data jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (workspace_key, record_key)
);

create index if not exists idx_app_records_updated_at
  on app_records(workspace_key, updated_at desc);

alter table app_records enable row level security;

drop policy if exists "anon read app_state_snapshots during no-login MVP" on app_state_snapshots;
drop policy if exists "anon write app_state_snapshots during no-login MVP" on app_state_snapshots;
drop policy if exists "anon read purchase_requests during no-login MVP" on purchase_requests;
drop policy if exists "anon write purchase_requests during no-login MVP" on purchase_requests;
drop policy if exists "anon read app_sync_events during no-login MVP" on app_sync_events;
drop policy if exists "anon write app_sync_events during no-login MVP" on app_sync_events;
drop policy if exists "anon read app_transaction_locks during no-login MVP" on app_transaction_locks;
drop policy if exists "anon write app_transaction_locks during no-login MVP" on app_transaction_locks;

create policy "authenticated read app_records"
  on app_records for select to authenticated using (true);

create policy "authenticated write app_records"
  on app_records for all to authenticated
  using (true)
  with check (auth.uid() is not null);

create or replace function set_app_record_updated_by()
returns trigger as $$
begin
  new.updated_by = auth.uid();
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists app_records_set_updated_by on app_records;
create trigger app_records_set_updated_by
  before insert or update on app_records
  for each row execute function set_app_record_updated_by();

-- Keep snapshot table readable to authenticated users for migration fallback,
-- but production writes should use app_records.
drop policy if exists "authenticated write app_state_snapshots" on app_state_snapshots;
