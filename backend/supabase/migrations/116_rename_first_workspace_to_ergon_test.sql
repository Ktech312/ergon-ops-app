-- Corrects the identity of the one workspace created by migration 115.
-- E: "I want the current environment treated as a general Ergon
-- product-development and testing workspace, not permanently identified
-- as an Ensight customer workspace." Renames the workspace's display
-- name and slug only -- no other column, table, policy, or row is
-- touched. Confirmed safe before writing this migration: a repo-wide
-- search found the `ensight` slug referenced nowhere outside migration
-- 115 itself (the workspaces table is not queried by any api/*.js route
-- or any src/*.tsx|ts file yet -- resolveActiveWorkspace() was designed
-- in PRODUCT_PHASE1_PLAN.md but was never wired into any route), so
-- there is nothing else to update in step with this rename.
--
-- IMPORTANT, not enforced by this migration (a documentation/process
-- matter, not a schema one -- see PRODUCT_PHASE1_PLAN.md and
-- PRODUCT_TENANCY_AUDIT.md): this workspace holds real Ergon/Ensight
-- operational data (real vendors, clients, projects, financial figures,
-- and employee accounts). Renaming it "Ergon Test Workspace" changes
-- only how it is labeled for future multi-workspace product-development
-- and testing purposes -- it does NOT make this workspace's data
-- fictional, and it must never be presented, seeded with demo content,
-- or exposed as a public-facing sales demo. A future public demo
-- requires either fictional data seeded into a wholly separate, isolated
-- demo workspace, or a from-scratch fictional dataset -- never a mix
-- with this workspace's real data.
--
-- Idempotent: safe to run more than once. After the first run, no row
-- has slug = 'ensight' anymore, so a second run matches zero rows and
-- changes nothing.

update workspaces
set name = 'Ergon Test Workspace', slug = 'ergon-test'
where slug = 'ensight';
