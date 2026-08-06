-- Lets an admin set the company name and logo shown in the top nav, so this
-- same app can be reused for a different company by just changing this row
-- and uploading a new logo -- no code/text hardcoding. Singleton table (a
-- single row, id is always true) since there is exactly one "the company"
-- for a given deployment of this app.

create table if not exists company_branding (
  id boolean primary key default true,
  company_name text not null default 'Ergon',
  logo_storage_path text,
  updated_at timestamptz not null default now(),
  constraint company_branding_singleton check (id)
);

insert into company_branding (id, company_name)
values (true, 'Ergon')
on conflict (id) do nothing;

alter table company_branding enable row level security;

create policy "authenticated read company_branding"
  on company_branding for select to authenticated using (true);

create policy "admin write company_branding"
  on company_branding for all to authenticated
  using (is_app_admin(auth.uid()))
  with check (is_app_admin(auth.uid()));

create or replace function set_company_branding_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists company_branding_set_updated_at on company_branding;
create trigger company_branding_set_updated_at
  before update on company_branding
  for each row execute function set_company_branding_updated_at();

-- Public bucket (unlike project-documents) since the logo needs to render
-- in the top nav for every signed-in user via a plain public URL, with no
-- signed-URL round trip on every page load. Anyone can read it; only an
-- admin can upload/replace it.
insert into storage.buckets (id, name, public)
values ('company-branding', 'company-branding', true)
on conflict (id) do nothing;

drop policy if exists "public read company-branding objects" on storage.objects;
create policy "public read company-branding objects"
  on storage.objects for select
  using (bucket_id = 'company-branding');

drop policy if exists "admin write company-branding objects" on storage.objects;
create policy "admin write company-branding objects"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'company-branding' and is_app_admin(auth.uid()));

drop policy if exists "admin update company-branding objects" on storage.objects;
create policy "admin update company-branding objects"
  on storage.objects for update to authenticated
  using (bucket_id = 'company-branding' and is_app_admin(auth.uid()))
  with check (bucket_id = 'company-branding' and is_app_admin(auth.uid()));

drop policy if exists "admin delete company-branding objects" on storage.objects;
create policy "admin delete company-branding objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'company-branding' and is_app_admin(auth.uid()));
