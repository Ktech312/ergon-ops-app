-- E noticed a Project created by converting a Closed-Won Sales Quote
-- (createProjectFromClosedWonQuote) had a blank Ref column. Root cause: the
-- app has two different ways a Project row gets created --
-- addDraftProject's "Add New Project" button computes a ref client-side
-- (nextProjectRef(), scanning existing projectSites in memory) before
-- saving, but the Sales-to-Projects conversion path inserts a project row
-- directly and never computed one at all.
--
-- Fix: assign project_number the same way migration 066 fixed Sales Quote
-- refs -- atomically, server-side, via a trigger + per-year counter table
-- -- so every insert path gets one automatically and two people converting
-- quotes at the same moment can't collide on the same number. This also
-- replaces the fragile "client scans existing refs for the max" approach
-- nextProjectRef() used, which had the same race-condition/reused-number-
-- after-deletion risk the Sales Quote ref fix called out.

create table if not exists project_ref_counters (
  year integer primary key,
  next_seq integer not null default 1
);

alter table project_ref_counters enable row level security;

create policy "authenticated read project_ref_counters"
  on project_ref_counters for select to authenticated using (true);

create policy "authenticated write project_ref_counters"
  on project_ref_counters for all to authenticated using (true) with check (true);

create or replace function assign_project_ref()
returns trigger
language plpgsql
as $$
declare
  ref_year integer := extract(year from now())::integer;
  seq integer;
begin
  if new.project_number is not null then
    return new;
  end if;

  insert into project_ref_counters (year, next_seq)
  values (ref_year, 2)
  on conflict (year) do update set next_seq = project_ref_counters.next_seq + 1
  returning next_seq - 1 into seq;

  new.project_number := 'PRJ-' || ref_year || '-' || lpad(seq::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists projects_assign_ref on projects;
create trigger projects_assign_ref
  before insert on projects
  for each row execute function assign_project_ref();

-- Seed the counter table from existing "PRJ-YYYY-####" refs (the ones
-- addDraftProject already assigned) so new ones never collide with them,
-- then backfill any project that's missing one (e.g. one already created
-- via the Sales-to-Projects conversion bug above), oldest first.
do $$
declare
  project record;
  ref_year integer;
  seq integer;
begin
  for project in
    select project_number, extract(year from created_at)::integer as ref_year
    from projects
    where project_number ~ '^PRJ-\d{4}-\d+$'
  loop
    insert into project_ref_counters (year, next_seq)
    values (project.ref_year, (regexp_match(project.project_number, '^PRJ-\d{4}-(\d+)$'))[1]::integer + 1)
    on conflict (year) do update
      set next_seq = greatest(project_ref_counters.next_seq, excluded.next_seq);
  end loop;

  for project in
    select id, created_at from projects where project_number is null order by created_at asc
  loop
    ref_year := extract(year from project.created_at)::integer;

    insert into project_ref_counters (year, next_seq)
    values (ref_year, 1)
    on conflict (year) do nothing;

    update project_ref_counters
    set next_seq = next_seq + 1
    where year = ref_year
    returning next_seq - 1 into seq;

    update projects set project_number = 'PRJ-' || ref_year || '-' || lpad(seq::text, 4, '0') where id = project.id;
  end loop;
end;
$$;
