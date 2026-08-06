-- Adds the new role keys E asked for, and lets a user hold more than one
-- role: exactly one "primary" role (drives their default tab set) plus any
-- number of "secondary" roles (adds access/visibility without replacing the
-- primary -- e.g. a PM who should also see Engineering requests). Before
-- this, app_user_roles.user_id was itself the primary key, so a user could
-- only ever have exactly one role row, period.

alter table app_user_roles drop constraint if exists app_user_roles_pkey;
alter table app_user_roles add column if not exists id uuid not null default gen_random_uuid();
alter table app_user_roles add constraint app_user_roles_pkey primary key (id);
alter table app_user_roles add column if not exists is_primary boolean not null default true;

alter table app_user_roles drop constraint if exists app_user_roles_role_key_check;
alter table app_user_roles add constraint app_user_roles_role_key_check
  check (role_key in (
    'warehouse', 'purchasing', 'pm', 'manager',
    'sales', 'engineering', 'product_development', 'implementation', 'support', 'marketing'
  ));

-- One row per (user, role) -- lets the app upsert a secondary role on/off
-- via PostgREST's on_conflict without duplicating rows.
create unique index if not exists idx_app_user_roles_user_role on app_user_roles(user_id, role_key);

-- A user should only ever have one row marked primary. Enforced at the
-- application layer (delete-then-insert when changing a primary role,
-- matching how e.g. task close/reopen is already handled) rather than a
-- DB constraint, since a simple partial-unique index can't be targeted by
-- PostgREST's on_conflict for the delete+insert sequence this needs.
create index if not exists idx_app_user_roles_primary on app_user_roles(user_id) where is_primary;
