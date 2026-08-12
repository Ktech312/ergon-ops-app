-- Adds two things E asked for on the Sales page:
--
-- 1. A stable reference number ("SQ-2026-0001") assigned once, atomically,
--    the moment a quote is created -- same "PRJ-2026-####" convention
--    Projects already uses, but assigned server-side via a counter table +
--    trigger instead of the client scanning existing refs, so two reps
--    creating quotes at the same moment can't collide on the same number.
-- 2. closed_at, set whenever a quote's status moves to closed_won/
--    closed_lost (and cleared if it's reopened to "open") -- needed to
--    answer "how many quotes closed this year" and "profit from deals
--    closed this year" on the new Sales metric row, since created_at alone
--    doesn't tell you when a deal actually closed.

create table if not exists sales_quote_ref_counters (
  year integer primary key,
  next_seq integer not null default 1
);

-- Same "authenticated, fully open" policy shape every other internal table
-- in this schema uses (e.g. project_locations) -- there's nothing
-- user-specific in here, it's just an internal counter, but it still needs
-- RLS enabled with a policy rather than left off entirely, since the
-- trigger below runs as the calling user (not a privileged role) and would
-- otherwise get blocked from incrementing it.
alter table sales_quote_ref_counters enable row level security;

create policy "authenticated read sales_quote_ref_counters"
  on sales_quote_ref_counters for select to authenticated using (true);

create policy "authenticated write sales_quote_ref_counters"
  on sales_quote_ref_counters for all to authenticated using (true) with check (true);

alter table sales_quotes add column if not exists quote_ref text;
alter table sales_quotes add column if not exists closed_at timestamptz;

create or replace function assign_sales_quote_ref()
returns trigger
language plpgsql
as $$
declare
  ref_year integer := extract(year from now())::integer;
  seq integer;
begin
  if new.quote_ref is not null then
    return new;
  end if;

  insert into sales_quote_ref_counters (year, next_seq)
  values (ref_year, 2)
  on conflict (year) do update set next_seq = sales_quote_ref_counters.next_seq + 1
  returning next_seq - 1 into seq;

  new.quote_ref := 'SQ-' || ref_year || '-' || lpad(seq::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists sales_quotes_assign_ref on sales_quotes;
create trigger sales_quotes_assign_ref
  before insert on sales_quotes
  for each row execute function assign_sales_quote_ref();

-- Backfill existing quotes with a ref number, oldest-to-newest per calendar
-- year (matches how a rep would expect them to read), reusing the same
-- counters table the trigger above uses so it's left correctly seeded for
-- whatever year(s) real quotes already exist in.
do $$
declare
  quote record;
  ref_year integer;
  seq integer;
begin
  for quote in select id, created_at from sales_quotes where quote_ref is null order by created_at asc loop
    ref_year := extract(year from quote.created_at)::integer;

    insert into sales_quote_ref_counters (year, next_seq)
    values (ref_year, 1)
    on conflict (year) do nothing;

    update sales_quote_ref_counters
    set next_seq = next_seq + 1
    where year = ref_year
    returning next_seq - 1 into seq;

    update sales_quotes set quote_ref = 'SQ-' || ref_year || '-' || lpad(seq::text, 4, '0') where id = quote.id;
  end loop;
end;
$$;

alter table sales_quotes add constraint sales_quotes_quote_ref_unique unique (quote_ref);
alter table sales_quotes alter column quote_ref set not null;
