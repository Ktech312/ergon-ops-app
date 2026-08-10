-- E's feedback: the New/Edit Site sheet and the Site Intake Questionnaire
-- need to ask for "the same info" -- specifically a real address for both
-- the site and the client company, not just a bare city. Reuses the
-- existing `city` column as the Site's city (no rename, to avoid a
-- backfill); everything else here is new.
alter table sales_quotes add column if not exists site_street_address text;
alter table sales_quotes add column if not exists site_state text;
alter table sales_quotes add column if not exists site_zip text;
alter table sales_quotes add column if not exists client_street_address text;
alter table sales_quotes add column if not exists client_city text;
alter table sales_quotes add column if not exists client_state text;
alter table sales_quotes add column if not exists client_zip text;
