-- Phase 11: standard install times, project schedule templates, and
-- Submittals (client approval before final purchasing).
--
-- Decisions already made by E (Aug 2026): scheduling math stays a
-- deterministic formula (standard time x BOM quantity), not a full
-- generative AI call. Submittal sign-off is an audit-trailed
-- click-to-approve, not a third-party e-signature.
--
-- Public access (a client reviewing/approving a submittal with no login)
-- is handled via two security-definer RPC functions rather than a broad
-- anon SELECT/UPDATE policy, so a client can only ever see/act on the one
-- submittal their token points to -- not browse the table. This needs no
-- new secret and no serverless function; it's plain Postgres, callable
-- through Supabase's existing REST RPC endpoint with just the anon key.

-- 1. Standard Time Library
create table if not exists standard_install_times (
  id uuid primary key default gen_random_uuid(),
  category text,
  inventory_item_id uuid references inventory_items(id),
  hours_per_unit numeric(10,2) not null default 0,
  crew_size_factor numeric(6,2) not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (category is not null or inventory_item_id is not null)
);

create unique index if not exists idx_standard_install_times_category
  on standard_install_times(category) where inventory_item_id is null;

create unique index if not exists idx_standard_install_times_item
  on standard_install_times(inventory_item_id) where inventory_item_id is not null;

alter table standard_install_times enable row level security;

create policy "authenticated read standard_install_times"
  on standard_install_times for select to authenticated using (true);

create policy "pm and admin write standard_install_times"
  on standard_install_times for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('pm'))
  with check (is_app_admin(auth.uid()) or has_role('pm'));

-- 2. Project Schedule Templates
create table if not exists project_schedule_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_schedule_template_phases (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references project_schedule_templates(id) on delete cascade,
  phase_name text not null,
  sequence_order integer not null default 0,
  depends_on_phase_id uuid references project_schedule_template_phases(id),
  duration_mode text not null default 'fixed_hours' check (duration_mode in ('fixed_hours', 'per_bom_unit')),
  fixed_hours numeric(10,2),
  bom_category_filter text,
  default_role text,
  created_at timestamptz not null default now()
);

create index if not exists idx_template_phases_template on project_schedule_template_phases(template_id, sequence_order);

alter table project_schedule_templates enable row level security;
alter table project_schedule_template_phases enable row level security;

create policy "authenticated read project_schedule_templates"
  on project_schedule_templates for select to authenticated using (true);

create policy "pm and admin write project_schedule_templates"
  on project_schedule_templates for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('pm'))
  with check (is_app_admin(auth.uid()) or has_role('pm'));

create policy "authenticated read project_schedule_template_phases"
  on project_schedule_template_phases for select to authenticated using (true);

create policy "pm and admin write project_schedule_template_phases"
  on project_schedule_template_phases for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('pm'))
  with check (is_app_admin(auth.uid()) or has_role('pm'));

-- Marker on tasks so re-applying a template updates rather than duplicates.
alter table tasks
  add column if not exists generated_from_template_phase_id uuid references project_schedule_template_phases(id);

-- 3. Generic public share tokens (reused by Phase 8's client progress view
-- once that's built -- Submittals is the first consumer).
create table if not exists public_share_tokens (
  token text primary key,
  entity_type text not null check (entity_type in ('project_submittal', 'project_progress')),
  entity_id uuid not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public_share_tokens enable row level security;

create policy "authenticated manage public_share_tokens"
  on public_share_tokens for all to authenticated using (true) with check (true);

-- 4. Submittals
create table if not exists project_submittals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'rejected', 'revision_requested')),
  content_snapshot jsonb not null default '{}'::jsonb,
  client_name text,
  client_email text,
  sent_at timestamptz,
  responded_at timestamptz,
  response_notes text,
  approval_name text,
  approval_ip text,
  approval_content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_submittals_project on project_submittals(project_id, version desc);

alter table project_submittals enable row level security;

create policy "authenticated read project_submittals"
  on project_submittals for select to authenticated using (true);

create policy "pm and admin write project_submittals"
  on project_submittals for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('pm'))
  with check (is_app_admin(auth.uid()) or has_role('pm'));

-- 5. Public RPCs -- callable by the anon role with just a token, no login.
-- Returns only the sanitized fields a client needs to review, never the
-- raw project_id or any internal cost/vendor data.
create or replace function get_submittal_by_token(share_token text)
returns table (
  submittal_id uuid,
  status text,
  version integer,
  content_snapshot jsonb,
  client_name text,
  project_name text
)
language sql
security definer
stable
as $$
  select s.id, s.status, s.version, s.content_snapshot, s.client_name, p.project_name
  from public_share_tokens t
  join project_submittals s on s.id = t.entity_id
  join projects p on p.id = s.project_id
  where t.token = share_token
    and t.entity_type = 'project_submittal'
    and (t.expires_at is null or t.expires_at > now());
$$;

grant execute on function get_submittal_by_token(text) to anon, authenticated;

create or replace function respond_to_submittal(share_token text, new_status text, approver_name text, approver_ip text, notes text)
returns void
language plpgsql
security definer
as $$
declare
  target_id uuid;
begin
  if new_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'Invalid submittal response status';
  end if;

  select s.id into target_id
  from public_share_tokens t
  join project_submittals s on s.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'project_submittal'
    and (t.expires_at is null or t.expires_at > now());

  if target_id is null then
    raise exception 'Invalid or expired submittal link';
  end if;

  update project_submittals
  set status = new_status,
      responded_at = now(),
      response_notes = notes,
      approval_name = approver_name,
      approval_ip = approver_ip,
      approval_content_hash = encode(sha256(content_snapshot::text::bytea), 'hex'),
      updated_at = now()
  where id = target_id;
end;
$$;

grant execute on function respond_to_submittal(text, text, text, text, text) to anon, authenticated;
