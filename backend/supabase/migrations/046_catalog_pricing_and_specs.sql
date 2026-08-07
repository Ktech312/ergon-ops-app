-- Fills in the gaps found in E's PandaDoc product export (flat_priced_products.csv)
-- that the catalog didn't have a place for yet: bundle/subscription
-- metadata and signage physical specs. Also adds the real pricing model E
-- asked for: a stored unit cost + an editable markup percent (sell price =
-- unit cost x (1 + markup%)), where unit cost is either entered manually or,
-- for costSource = 'inventory_unit_cost', resolved live from the linked
-- inventory item's current cost at render time (see main.tsx's
-- resolveCatalogUnitCost) -- never a stale stored number.

alter table product_catalog add column if not exists item_type text not null default 'regular' check (item_type in ('regular', 'bundle'));
alter table product_catalog add column if not exists billing_frequency text;
alter table product_catalog add column if not exists bundle_components text;
alter table product_catalog add column if not exists height_in text;
alter table product_catalog add column if not exists width_in text;
alter table product_catalog add column if not exists pixel_pitch_mm text;
alter table product_catalog add column if not exists builtin_flasher_module text;
alter table product_catalog add column if not exists additional_space_multiplier numeric(10,2);
alter table product_catalog add column if not exists insert_quantity integer;
alter table product_catalog add column if not exists unit_cost numeric(12,2) not null default 0;
alter table product_catalog add column if not exists markup_percent numeric(6,2) not null default 0;

-- Price-change approval workflow. Product Catalog writes are already
-- admin/manager-only (migration 033's RLS), so a Sales rep has no direct
-- write path to product_catalog at all -- this table is how they propose a
-- cost/markup/price change without needing that access. A manager or admin
-- reviews the request and, on approval, the app applies it to
-- product_catalog using their own already-authorized write access.
create table if not exists catalog_price_change_requests (
  id uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null references product_catalog(id) on delete cascade,
  requested_by_email text not null,
  field_changed text not null check (field_changed in ('unit_cost', 'markup_percent', 'default_sell_price')),
  previous_value numeric(12,2) not null,
  requested_value numeric(12,2) not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by_email text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_catalog_price_requests_item on catalog_price_change_requests(catalog_item_id);
create index if not exists idx_catalog_price_requests_status on catalog_price_change_requests(status);

alter table catalog_price_change_requests enable row level security;

create policy "authenticated create own price change requests"
  on catalog_price_change_requests for insert to authenticated
  with check (lower(requested_by_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "requester and admin/manager read price change requests"
  on catalog_price_change_requests for select to authenticated
  using (
    lower(requested_by_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or is_app_admin(auth.uid())
    or has_role('manager')
  );

create policy "admin/manager review price change requests"
  on catalog_price_change_requests for update to authenticated
  using (is_app_admin(auth.uid()) or has_role('manager'))
  with check (is_app_admin(auth.uid()) or has_role('manager'));

-- New notification events for the approval workflow, reusing migration
-- 024's existing engine (in-app bell + email/Slack once those channels are
-- toggled on for these event types).
alter table notification_rules drop constraint if exists notification_rules_event_type_check;
alter table notification_rules add constraint notification_rules_event_type_check
  check (event_type in (
    'task_assigned', 'task_overdue', 'task_status_changed',
    'purchase_request_status_changed', 'build_stage_changed',
    'submittal_responded', 'low_stock_reached',
    'catalog_price_change_requested', 'catalog_price_change_reviewed'
  ));

insert into notification_rules (event_type, channels, is_active)
values
  ('catalog_price_change_requested', '{in_app}', true),
  ('catalog_price_change_reviewed', '{in_app}', true)
on conflict (event_type) do nothing;
