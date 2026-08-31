-- Migration 102: Clients as a real entity, phase 4 of the Slack/ClickUp/
-- Drive roadmap (see HANDOFF.md). E: "when a project gets closed, that
-- whole section goes under the Client as one large combined section."
--
-- Before this, "client" was just a repeated text field on projects and
-- sales_quotes (project.customer_name/quote.client_name) with zero
-- deduplication -- two projects for the same real client showed as
-- unrelated rows. The reconciliation pass (live data, confirmed with E
-- 2026-08-30, see the answers this migration encodes below) found:
--   - "Exxon " (trailing space, both projects and sales_quotes) is one
--     client, Exxon -- just a whitespace data-quality issue, not two
--     different names.
--   - "Newport News" / "Newport News 37th St." (both free-text on
--     purchase_orders.project_name, never a real FK) and "Newport News
--     Shipbuilding" (the real projects.customer_name) are confirmed by
--     E as "different Sites/projects but all the same Client" -- exactly
--     the multi-site-per-client shape this whole feature exists for.
--     purchase_orders.project_name itself is untouched here (still free
--     text, and E was explicit these may become genuinely separate
--     sites/projects later) -- only the real client link is added.
--   - "Straud Medical" (3 purchase_orders, missing the 'b') is confirmed
--     a typo for "Straub Medical" -- fixed at the source this time,
--     since E confirmed it's simply wrong data, not a second entity.
--   - "Demo Client" (Lakeside Gate) is confirmed test data, explicitly
--     excluded -- no client record, left unlinked like other demo
--     content in this app.
--   - Flintco and Standard Parking exist only on sales_quotes so far
--     (no won project yet) -- still real clients, still get a row and a
--     channel now, so the moment a deal closes and becomes a project,
--     the client side is already in place.

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table clients enable row level security;
drop policy if exists "authenticated read clients" on clients;
create policy "authenticated read clients" on clients for select to authenticated using (true);
drop policy if exists "authenticated write clients" on clients;
create policy "authenticated write clients" on clients for all to authenticated using (true) with check (true);

alter table projects add column if not exists client_id uuid references clients(id);
alter table sales_quotes add column if not exists client_id uuid references clients(id);

-- Data-quality fixes confirmed by E, not guessed.
update projects set customer_name = trim(customer_name) where customer_name like '% ' or customer_name like ' %';
update sales_quotes set client_name = trim(client_name) where client_name like '% ' or client_name like ' %';
update purchase_orders set project_name = 'Straub Medical HI' where project_name = 'Straud Medical';

-- The 6 real clients confirmed in the reconciliation pass. "Demo Client"
-- is deliberately not seeded here.
insert into clients (name) values
  ('East Central'),
  ('Exxon'),
  ('Newport News Shipbuilding'),
  ('Straub Medical'),
  ('Flintco'),
  ('Standard Parking')
on conflict (name) do nothing;

update projects set client_id = (select id from clients where name = 'East Central') where trim(customer_name) = 'East Central';
update projects set client_id = (select id from clients where name = 'Exxon') where trim(customer_name) = 'Exxon';
update projects set client_id = (select id from clients where name = 'Newport News Shipbuilding') where trim(customer_name) = 'Newport News Shipbuilding';
update projects set client_id = (select id from clients where name = 'Straub Medical') where trim(customer_name) = 'Straub Medical';

update sales_quotes set client_id = (select id from clients where name = 'Exxon') where trim(client_name) = 'Exxon';
update sales_quotes set client_id = (select id from clients where name = 'Flintco') where trim(client_name) = 'Flintco';
update sales_quotes set client_id = (select id from clients where name = 'Standard Parking') where trim(client_name) = 'Standard Parking';

-- Client channels (migration 101 already anticipated this -- 'client' was
-- already a valid channels.type). One permanent channel per client, same
-- "never dies" guarantee project channels already have.
alter table channels add column if not exists client_id uuid references clients(id) on delete cascade;
alter table channels drop constraint if exists channels_type_client_id_key;
alter table channels add constraint channels_type_client_id_key unique (type, client_id);

insert into channels (type, client_id, name)
select 'client', id, name from clients
on conflict (type, client_id) do nothing;

create or replace function create_client_channel()
returns trigger as $$
begin
  insert into channels (type, client_id, name)
  values ('client', new.id, new.name)
  on conflict (type, client_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists clients_create_channel on clients;
create trigger clients_create_channel
  after insert on clients
  for each row execute function create_client_channel();
