-- Migration 073: SaaS contract tracking, for the new SaaS Calendar
-- (renewal outreach + MRR/ARR/5-year revenue outlook).
--
-- Pricing lives on the Sales Quote (the actual signed contract) and
-- carries over to the Project when it's created from a Closed - Won
-- quote, same one-time-copy pattern as the rest of that conversion.
-- "Closed" is a new project status -- when a PM marks a project Closed,
-- that's the SaaS contract start date (the app stamps it automatically).

alter table sales_quotes add column if not exists saas_type text;
alter table sales_quotes add column if not exists saas_contract_amount numeric;
alter table sales_quotes add column if not exists saas_billing_frequency text
  check (saas_billing_frequency in ('Monthly', 'Quarterly', 'Annual'));

alter table projects drop constraint if exists projects_app_status_check;
alter table projects add constraint projects_app_status_check
  check (app_status in ('Draft', 'Planning', 'Procurement', 'Staging', 'Install Ready', 'Closed'));

alter table projects add column if not exists saas_type text;
alter table projects add column if not exists saas_contract_amount numeric;
alter table projects add column if not exists saas_billing_frequency text
  check (saas_billing_frequency in ('Monthly', 'Quarterly', 'Annual'));
alter table projects add column if not exists saas_start_date date;
alter table projects add column if not exists saas_renewal_date date;
