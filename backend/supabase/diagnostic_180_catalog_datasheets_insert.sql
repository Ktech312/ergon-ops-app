-- Diagnostic only, not a migration. begin;/rollback; -- touches nothing.
-- Reproduces migration_180's Section 3 catalog-datasheets NEW-scheme
-- insert WITHOUT catching the exception, so the real Postgres error
-- (SQLSTATE + message) is visible instead of being swallowed by the
-- test's generic "TEST FAILED" wrapper.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  catalog_a_id uuid;
begin
  select am.user_id, wm.workspace_id
    into real_user_id, real_workspace_id
  from public.app_admins am
  join public.workspace_members wm on wm.user_id = am.user_id
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.product_catalog (catalog_number, product_name)
    values ('ZZ-DIAG-180-CAT', 'ZZ_DIAG_180 Catalog Item')
    returning id into catalog_a_id;

  raise notice 'catalog_a_id = %, workspace_id on that row = %, real_workspace_id = %',
    catalog_a_id,
    (select workspace_id from public.product_catalog where id = catalog_a_id),
    real_workspace_id;

  -- No exception handler here on purpose -- let the real error surface.
  insert into storage.objects (bucket_id, name) values ('catalog-datasheets', catalog_a_id::text || '/stamp-fixture.pdf');

  raise notice 'INSERT SUCCEEDED -- no error to diagnose';
end;
$$;

rollback;
