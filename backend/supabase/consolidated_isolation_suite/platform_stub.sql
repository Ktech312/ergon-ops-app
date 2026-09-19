-- Minimal Supabase-platform stub.
--
-- Reconstructs just enough of the auth/storage schemas and platform
-- roles -- normally provided by Supabase's own GoTrue (auth) and Storage
-- services, never by anything in backend/supabase/migrations/ -- for this
-- repo's real 001...185 migration files to apply verbatim against a real
-- local Postgres engine (PGlite) and for their RLS policies (auth.uid(),
-- auth.jwt(), storage.objects/buckets) to behave correctly under
-- set_config('request.jwt.claims', ...) / set_config('role', 'authenticated', ...),
-- exactly the mechanism every canonical migration_N_..._tests.sql file uses
-- to simulate a specific authenticated caller.
--
-- Consolidated from scratchpad/pgtest/init.sql, which individual
-- migration-verification passes built up piecemeal across this session
-- and validated against increasingly large slices of the real migration
-- history (up through a full 001-185 replay). This file is that same
-- stub, kept as the one permanent, reusable copy -- nothing here is a
-- migration itself and nothing here is ever applied to a real Supabase
-- project (Supabase provides the real auth/storage schemas there).
--
-- This file must be applied to a FRESH database, before any of
-- backend/supabase/migrations/*.sql are applied.

create schema if not exists auth;
create schema if not exists storage;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create table storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now()
);

alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;
grant all on storage.buckets to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;

-- Real Supabase grants anon/authenticated/service_role blanket table
-- privileges at the platform level (RLS is what actually restricts
-- access) -- this repo's migrations never grant those themselves. Applied
-- as default privileges so every table any migration creates from here on
-- automatically gets them too, without editing every CREATE TABLE.
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
