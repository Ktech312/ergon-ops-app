-- Second half of the one realistic starting fixture (see seed_fixture.sql
-- for the first half and the rationale for keeping this minimal and
-- migration-driven rather than hand-built).
--
-- Every canonical migration_N_..._tests.sql file discovers its OWN real
-- test subjects at run time (a real PM user, a real Sales user, a real
-- warehouse-role user, a real legacy-'manager' user, a real plain
-- non-admin member with no privileged role) rather than fabricating one
-- itself -- correct discipline against a real production database, which
-- always has a variety of real accounts to find. Individual per-migration
-- verification passes this session ran each test's discovery query
-- against real production directly, where that variety already exists.
--
-- This consolidated suite's bootstrap starts from a single admin account
-- (seed_fixture.sql), so without this file, every one of those discovery
-- queries comes back empty and the affected sections report themselves
-- as SKIPPED (each test file's own, already-correct "SECTIONS SKIPPED"
-- failure mode -- not a crash, not a false pass, but not a real run
-- either). This is a consolidated-suite bootstrap gap, not a bug in any
-- test file: adding a small, realistic set of additional real users with
-- real roles here lets every discovery query find a genuine candidate,
-- the same way it would against real production.
--
-- Applied AFTER migration 040 (role_expansion_multi_role), the first
-- point at which app_user_roles has its current (id, is_primary) shape
-- and its full role_key vocabulary -- and well BEFORE migration 115
-- (workspaces_foundation), so these rows flow through that migration's
-- own real backfill into workspace_members/workspace_member_roles
-- exactly like the admin account does, rather than being inserted into
-- workspace_members by hand.

insert into auth.users (id, email) values
  (gen_random_uuid(), 'pm-fixture@ergon-test.local'),
  (gen_random_uuid(), 'sales-fixture@ergon-test.local'),
  (gen_random_uuid(), 'warehouse-fixture@ergon-test.local'),
  (gen_random_uuid(), 'manager-fixture@ergon-test.local'),
  (gen_random_uuid(), 'staff-fixture@ergon-test.local');

insert into app_user_roles (user_id, role_key, is_primary)
select id, 'pm', true from auth.users where email = 'pm-fixture@ergon-test.local'
union all
select id, 'sales', true from auth.users where email = 'sales-fixture@ergon-test.local'
union all
select id, 'warehouse', true from auth.users where email = 'warehouse-fixture@ergon-test.local'
union all
select id, 'manager', true from auth.users where email = 'manager-fixture@ergon-test.local'
-- Deliberately 'engineering', not one of the roles any canonical test
-- specifically searches for by name (pm/sales/warehouse/manager/admin) --
-- this is the fixture's one genuinely "plain, non-privileged, non-admin"
-- real member, matching what several tests call a "same-workspace,
-- non-admin, non-pm user" or similar.
union all
select id, 'engineering', true from auth.users where email = 'staff-fixture@ergon-test.local';
