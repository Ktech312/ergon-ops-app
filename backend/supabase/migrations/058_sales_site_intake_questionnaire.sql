-- Solves two gaps flagged after building the Site Builder location work:
-- (1) there was no way to go back and view/edit a quote's original "New
-- Site" intake fields once created, and (2) the sales team wants a large,
-- growing set of client-facing questions to ask during intake -- exactly
-- what the Phase 18 Fluid Form Engine (migration 026) was built for.
-- form_schemas/form_schema_fields are already generic (keyed by
-- form_key), so this only needs a new schema row + a new response-storage
-- table (sales_quote_intake_responses, mirroring project_handovers but
-- keyed by quote instead of project) -- no changes to the form engine
-- tables themselves.

insert into form_schemas (form_key, name, description)
values ('sales_site_intake', 'Site Intake Questionnaire', 'Questions a sales rep asks the client while scoping a new site. Add/reorder/remove questions in Admin -> Form Builder as the real question set grows.')
on conflict (form_key) do nothing;

-- Small starter set so the form isn't empty on first use -- E said the
-- real "large criteria" is still coming; these are placeholders to add to
-- from Admin, not the final question set.
insert into form_schema_fields (form_schema_id, section, field_key, label, field_type, placeholder, is_required, options, sequence_order)
select fs.id, v.section, v.field_key, v.label, v.field_type, v.placeholder, v.is_required, v.options::jsonb, v.sequence_order
from form_schemas fs
cross join (values
  ('client_details', 'decision_maker', 'Who is the decision maker on this deal?', 'text', null, false, '[]', 0),
  ('client_details', 'timeline', 'Desired go-live timeline', 'text', 'e.g. Q3 2026', false, '[]', 1),
  ('site_conditions', 'existing_cameras', 'Are there existing cameras/sensors on site today?', 'select', null, false, '["Yes", "No", "Unsure"]', 2),
  ('site_conditions', 'network_readiness', 'Network/infrastructure readiness notes', 'textarea', 'Conduit, switches, existing cabling...', false, '[]', 3)
) as v(section, field_key, label, field_type, placeholder, is_required, options, sequence_order)
where fs.form_key = 'sales_site_intake'
on conflict (form_schema_id, field_key) do nothing;

-- One row per quote (unique quote_id) -- this is the sales team's ongoing
-- working notes on a client, not a one-time signed capture like a
-- Submittal or Handover, so there's no draft/submitted status here, just
-- an editable jsonb bag that gets upserted as answers come in.
create table if not exists sales_quote_intake_responses (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references sales_quotes(id) on delete cascade,
  form_schema_id uuid not null references form_schemas(id),
  responses jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function set_sales_quote_intake_responses_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sales_quote_intake_responses_set_updated_at on sales_quote_intake_responses;
create trigger sales_quote_intake_responses_set_updated_at
  before update on sales_quote_intake_responses
  for each row execute function set_sales_quote_intake_responses_updated_at();

alter table sales_quote_intake_responses enable row level security;

-- Same openness as the rest of the Sales side (sales_quotes, migration
-- 033) -- any authenticated user can read/write.
create policy "authenticated read sales_quote_intake_responses"
  on sales_quote_intake_responses for select to authenticated using (true);

create policy "authenticated write sales_quote_intake_responses"
  on sales_quote_intake_responses for all to authenticated using (true) with check (true);
