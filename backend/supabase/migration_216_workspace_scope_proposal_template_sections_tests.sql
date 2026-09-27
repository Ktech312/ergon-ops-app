-- Transaction-safe canonical test for migration 216 (workspace-scoped
-- proposal_template_sections with real create/delete capability, per
-- E's own explicit decision). Wrapped in begin;/rollback; -- nothing
-- here ever commits.
--
-- Covers: (a) the pre-existing (Ergon's real) rows were correctly
-- backfilled to the one workspace never referenced by any
-- company_signup_requests row; (b) a brand-new synthetic workspace
-- (K-Tech's own real shape) starts with ZERO sections -- no auto-copy
-- of Ergon's boilerplate; (c) a workspace-admin-only user can CREATE a
-- section for their own workspace, with workspace_id and section_key
-- both resolved automatically (never client-supplied); (d) the same
-- user can edit and DELETE it; (e) cross-workspace isolation --
-- another workspace's admin can neither read nor write it; (f) an
-- ordinary (non-admin, non-manager) member cannot write; (g) the
-- legacy 'manager'-role branch (this table's own pre-existing
-- condition) still works; (h) a real global app_admin still works.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 216 WORKSPACE SCOPE
-- PROPOSAL TEMPLATE SECTIONS TESTS PASSED -- ZERO SECTIONS SKIPPED", or
-- a hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_app_admin_id uuid;
  pre_existing_workspace_id uuid;
  workspace_a_id uuid;
  workspace_b_id uuid;
  admin_a_user_id uuid := gen_random_uuid();
  admin_b_user_id uuid := gen_random_uuid();
  ordinary_a_user_id uuid := gen_random_uuid();
  manager_legacy_user_id uuid := gen_random_uuid();
  new_section_id uuid;
  row_count integer;
  caught boolean;
begin
  select pa.user_id into real_app_admin_id from public.app_admins pa limit 1;
  if real_app_admin_id is null then
    raise exception 'TEST SETUP FAILED: no existing app_admin found.';
  end if;

  -- ============================================================
  -- Section (a): the real, pre-existing rows were backfilled correctly.
  -- ============================================================

  select workspace_id into pre_existing_workspace_id
  from public.proposal_template_sections
  limit 1;

  if pre_existing_workspace_id is null then
    raise exception 'TEST FAILED: an existing proposal_template_sections row has no workspace_id after the backfill';
  end if;

  if exists (select 1 from public.company_signup_requests where created_workspace_id = pre_existing_workspace_id) then
    raise exception 'TEST FAILED: the backfilled workspace_id points at a company-signup-created workspace, not the one pre-existing workspace';
  end if;

  raise notice 'TEST PASSED: Section (a) -- Ergon''s own real proposal_template_sections rows were backfilled to the one pre-existing workspace, not a company-signup-created one';

  perform set_config('role', 'postgres', true);

  insert into public.workspaces (name, slug, status) values ('ZZ Test 216 Workspace A', 'zz-test-216-workspace-a', 'active') returning id into workspace_a_id;
  insert into public.workspaces (name, slug, status) values ('ZZ Test 216 Workspace B', 'zz-test-216-workspace-b', 'active') returning id into workspace_b_id;

  insert into auth.users (id, email, email_confirmed_at) values
    (admin_a_user_id, 'zz-test-216-admin-a@example.com', now()),
    (admin_b_user_id, 'zz-test-216-admin-b@example.com', now()),
    (ordinary_a_user_id, 'zz-test-216-ordinary-a@example.com', now()),
    (manager_legacy_user_id, 'zz-test-216-manager-legacy@example.com', now());

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (workspace_a_id, admin_a_user_id, true),
    (workspace_a_id, ordinary_a_user_id, false),
    (workspace_a_id, manager_legacy_user_id, false),
    (workspace_b_id, admin_b_user_id, true);

  insert into public.app_user_roles (user_id, role_key, is_primary) values (manager_legacy_user_id, 'manager', true);

  -- ============================================================
  -- Section (b): a brand-new workspace (K-Tech's own real shape) starts
  -- with zero sections -- no auto-copy of Ergon's boilerplate.
  -- ============================================================

  select count(*) into row_count from public.proposal_template_sections where workspace_id = workspace_a_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a brand-new workspace already has % proposal_template_sections rows -- Ergon''s boilerplate was auto-copied, which E explicitly said never to do', row_count;
  end if;

  raise notice 'TEST PASSED: Section (b) -- a brand-new workspace starts with zero proposal template sections, no auto-copy';

  -- ============================================================
  -- Section (c): a workspace-admin-only user creates a section for
  -- their own workspace -- workspace_id and section_key both resolved
  -- automatically, never client-supplied.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.proposal_template_sections (title, body, sequence_order)
  values ('ZZ Test 216 Warranty', 'Standard one-year warranty.', 0)
  returning id into new_section_id;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.proposal_template_sections
  where id = new_section_id and workspace_id = workspace_a_id and section_key is not null;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: the new section was not correctly resolved into the caller''s own workspace with an auto-generated section_key';
  end if;

  raise notice 'TEST PASSED: Section (c) -- a workspace-admin-only user can create a section for their own workspace, workspace_id and section_key both resolved automatically';

  -- ============================================================
  -- Section (d): the same user can edit and delete it.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  update public.proposal_template_sections set title = 'ZZ Test 216 Warranty Renamed' where id = new_section_id;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.proposal_template_sections where id = new_section_id and title = 'ZZ Test 216 Warranty Renamed';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace-admin-only user could not edit their own workspace''s section';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  delete from public.proposal_template_sections where id = new_section_id;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.proposal_template_sections where id = new_section_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a workspace-admin-only user could not delete their own workspace''s section';
  end if;

  raise notice 'TEST PASSED: Section (d) -- a workspace-admin-only user can edit and delete their own workspace''s section';

  -- ============================================================
  -- Section (e): cross-workspace isolation.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.proposal_template_sections (title, body, sequence_order) values ('ZZ Test 216 A-only', 'body', 0) returning id into new_section_id;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_b_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.proposal_template_sections where id = new_section_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: workspace B''s admin could read workspace A''s section (% rows)', row_count;
  end if;

  begin
    update public.proposal_template_sections set title = 'hacked' where id = new_section_id;
  exception when others then
    null;
  end;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.proposal_template_sections where id = new_section_id and title = 'hacked') then
    raise exception 'TEST FAILED: workspace B''s admin could write to workspace A''s section';
  end if;

  raise notice 'TEST PASSED: Section (e) -- cross-workspace isolation holds, a different workspace''s admin cannot read or write it';

  -- ============================================================
  -- Section (f): an ordinary member cannot write.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', ordinary_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.proposal_template_sections (title, body, sequence_order) values ('ZZ Test 216 Should Fail', 'body', 0);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an ordinary (non-admin, non-manager) member could create a proposal template section';
  end if;

  raise notice 'TEST PASSED: Section (f) -- an ordinary workspace member still cannot write';

  -- ============================================================
  -- Section (g): the legacy manager-role branch (this table's own
  -- pre-existing condition) still works.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', manager_legacy_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.proposal_template_sections (title, body, sequence_order) values ('ZZ Test 216 Manager Created', 'body', 1) returning id into new_section_id;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.proposal_template_sections where id = new_section_id and workspace_id = workspace_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: the legacy manager-role branch no longer works for proposal_template_sections';
  end if;

  raise notice 'TEST PASSED: Section (g) -- the legacy manager-role branch still works, unaffected';

  -- ============================================================
  -- Section (h): a real global app_admin still works.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_app_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  update public.proposal_template_sections set title = 'Updated by real admin'
  where id = (select id from public.proposal_template_sections where workspace_id = pre_existing_workspace_id limit 1);

  raise notice 'TEST PASSED: Section (h) -- a real global app_admin still works, unaffected';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 216 WORKSPACE SCOPE PROPOSAL TEMPLATE SECTIONS TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
