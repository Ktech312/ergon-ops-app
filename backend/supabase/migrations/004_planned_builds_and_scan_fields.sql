-- Planned manufacturing workflow and scan-ready inventory fields.
-- Keeps the database model aligned with the frontend's safer build flow:
-- plan first, kit/assemble/test, then consume parts only when the build is completed.

alter table inventory_items
  add column if not exists barcode_value text,
  add column if not exists image_url text,
  add column if not exists manufacturer text,
  add column if not exists purchase_sources jsonb not null default '[]'::jsonb,
  add column if not exists inventory_tags text[] not null default '{}'::text[],
  add column if not exists retired_at timestamptz;

create index if not exists idx_inventory_items_barcode_value on inventory_items(barcode_value);
create index if not exists idx_inventory_items_inventory_tags on inventory_items using gin(inventory_tags);

alter table inventory_transactions
  drop constraint if exists inventory_transactions_transaction_status_check;

alter table inventory_transactions
  add constraint inventory_transactions_transaction_status_check
  check (transaction_status in ('draft', 'planned', 'posted', 'undone', 'cancelled'));

alter table build_transactions
  add column if not exists workflow_stage text not null default 'complete',
  add column if not exists planned_at timestamptz,
  add column if not exists cancelled_at timestamptz;

alter table build_transactions
  drop constraint if exists build_transactions_status_check;

alter table build_transactions
  add constraint build_transactions_status_check
  check (status in ('draft', 'planned', 'posted', 'undone', 'cancelled'));

alter table build_transactions
  drop constraint if exists build_transactions_workflow_stage_check;

alter table build_transactions
  add constraint build_transactions_workflow_stage_check
  check (workflow_stage in ('planned', 'kitting', 'assembled', 'tested', 'complete'));

create index if not exists idx_build_transactions_status_stage on build_transactions(status, workflow_stage, created_at desc);

update build_transactions
set workflow_stage = case
  when status = 'planned' then 'planned'
  when status = 'draft' then 'planned'
  else 'complete'
end
where workflow_stage is null or workflow_stage = '';
