-- Migration 090: Client Ledger restructure -- E clarified after seeing the
-- first pass (2026-08-23): the tab's default list was auto-populating from
-- every non-closed project, which isn't the intended workflow at all.
--
-- Corrected shape:
-- - "Closed Projects": auto-populated ONLY by projects a PM has actually
--   set to Closed -- a staging queue, not a general project list.
-- - "Primary List": the real master ledger. Someone has to deliberately
--   move a project out of the Closed Projects queue into here -- closing
--   a project does NOT by itself create a ledger entry.
-- - Once in the Primary List, whether a site counts as "Active" or
--   "Archived" is a manual choice (ongoing SaaS/support relationship vs.
--   fully wrapped up), independent of the project's own status field.
--
-- Same table as migration 089's kickoff_date/warranty_expiration_date --
-- lightweight, loaded separately from the main Projects query so an
-- un-run migration only affects the Client Ledger tab.

alter table projects add column if not exists added_to_ledger boolean not null default false;
alter table projects add column if not exists ledger_bucket text check (ledger_bucket in ('active', 'archived'));
