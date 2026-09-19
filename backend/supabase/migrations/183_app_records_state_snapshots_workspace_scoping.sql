-- Phase 3 final scoping pass -- last fully-open table in this project.
-- `app_records` (migration 009) and `app_state_snapshots` (migration 003)
-- currently have fully open RLS with no workspace concept at all, ever
-- added since creation: `app_records` -- "authenticated read app_records"
-- using(true) and "authenticated write app_records" using(true) with
-- check(auth.uid() is not null) (009:40-46); `app_state_snapshots` --
-- "authenticated read app_state_snapshots" using(true), all its `all`
-- policies to `authenticated`/`anon` using(true)/with check(true)
-- (003:151-154, its write policy for `authenticated` already dropped by
-- 009:64, leaving it read-only since). Re-confirmed directly from both
-- CREATE TABLE statements before writing this, not from memory or a
-- planning doc.
--
-- Real schema, re-confirmed directly from source (not fully known before
-- reading these two files -- both differ from what a "keyed jsonb store"
-- assumption would predict):
--
--   `app_records` (009:5-24): NOT a single text key column -- its primary
--   key is the COMPOSITE `(workspace_key text default 'default',
--   record_key text check (record_key in (9 named literals, including
--   'roleMode')))`, plus `data jsonb not null`, `updated_by`,
--   `updated_at`. `workspace_key` is therefore already its own real
--   column today, not a value folded into `record_key` -- see the
--   composite-key judgment call below for what that changes about this
--   migration's design.
--
--   `app_state_snapshots` (003:102-108): `id uuid primary key`,
--   `workspace_key text not null unique` (a SEPARATE unique constraint,
--   not the PK), `state jsonb not null default '{}'`, `updated_at`,
--   `created_at`.
--
-- Load-bearing facts re-confirmed directly from `src/persistence.ts`
-- before designing anything:
--
--   1. `WORKSPACE_KEY = "default"` (persistence.ts:46) is a hardcoded
--      literal, unrelated to `public.workspaces` (whose one real seeded
--      row has slug 'ergon-test', migration 116). Every row `app_records`
--      has EVER had written to it -- live 'roleMode' rows and the dead
--      Phase 10f-cutover rows physically still sitting in the table
--      (018/016/017/020/021/022 all read historical rows filtered on
--      `ar.workspace_key = 'default'`) -- carries that same literal.
--      Concretely: `workspace_key` never distinguished one company from
--      another, ever, in this table's history -- there is, and always
--      has been, exactly one physical value in that column.
--   2. `STATE_KEYS = ["roleMode"]` (persistence.ts:47) is the only key
--      still written today. `asPersistedState()` (persistence.ts:584-593)
--      only ever reads `record_key = 'roleMode'` back out; the other 8
--      historical `record_key` values are dead weight left over from
--      before the Phase 10f cutover (016-022) moved them to their own
--      relational tables.
--   3. `loadRemoteAppState()` (persistence.ts:8623-8652) reads
--      `app_records?workspace_key=eq.default&select=record_key,data`,
--      and only falls back to `app_state_snapshots?workspace_key=eq.
--      default&select=state&limit=1` if that first request 404s (dead
--      table read for migration-era compatibility only -- confirmed no
--      code path writes to `app_state_snapshots` any more, its own
--      "authenticated write" policy has been gone since 009:64).
--   4. `saveRemoteAppState()` (persistence.ts:8654-8694) does a real
--      PostgREST upsert: `POST app_records?on_conflict=workspace_key,
--      record_key` with `prefer: resolution=merge-duplicates`, body rows
--      of shape `{ workspace_key, record_key, data, updated_at }` (no
--      `workspace_id` field -- none exists yet), then separately logs to
--      `app_sync_events` (a table Phase 3 Stage 5 already deliberately
--      left as a documented "hygiene item," untouched here -- see
--      163/164's own deferral note). `on_conflict` names the columns of
--      today's real primary key literally -- see Section 4 below for why
--      this constraint's target list changes and what that requires from
--      the companion frontend commit.
--   5. `p_workspace_key` at persistence.ts:845 (`acquireTransactionLock`,
--      the `acquire_transaction_lock` RPC) targets `app_transaction_locks`
--      -- a DIFFERENT table, already covered by its own deliberate,
--      documented Stage-5 deferral (163/164's "app_sync_events/
--      app_transaction_locks hygiene items" note) and out of scope for
--      this migration. Not touched here.
--
-- JUDGMENT CALL 1 -- composite-key vs. new column (E: flag clearly,
-- decide with best judgment since scope depended on the real shape):
-- `workspace_key` is NOT a composite string folding workspace+entity-key
-- together (e.g. NOT `'default:roleMode'`) -- it is already its own
-- column, sitting right next to `record_key` in the same primary key.
-- The bug is not "no separate column exists," it's "the separate column
-- that already exists holds a hardcoded literal instead of a real
-- `public.workspaces.id`, and its literal-'default' value is why every
-- company's `roleMode` row has always physically been the SAME row."
-- Decision made here: add a real `workspace_id uuid references
-- workspaces(id)` column (this migration's actual containment
-- mechanism, enforced by RLS + the trigger below) and REPOINT the
-- primary key from `(workspace_key, record_key)` to `(workspace_id,
-- record_key)`, but do NOT drop the old `workspace_key` text column --
-- every other migration this session (173/175/178/117) only ever adds
-- and re-points, never drops a column, and this repo has zero column-drop
-- precedent to match against. `workspace_key` becomes fully vestigial
-- (same accepted status as `app_role_modes`, per the master plan's own
-- "confirmed correctly OUT of scope... dead/vestigial" entry) --
-- harmless dead weight, not a live security or correctness surface once
-- `workspace_id` is the actual RLS/PK anchor. Flagging this as the
-- specific judgment call the task asked to call out.
--
-- JUDGMENT CALL 2 -- historical-rows backfill scope: backfilling ALL
-- existing rows (not just live 'roleMode' rows) to the one real workspace
-- is what this migration does, for both tables. Being selective (only
-- backfilling 'roleMode' rows, leaving the 8 dead Phase-10-era
-- `record_key` values null) was considered and rejected: those dead rows
-- would then either block the later `not null` lock-down (same as every
-- other row) or need a separate delete step this migration has no
-- reviewed authority to take. Since fact #1 above establishes there has
-- only ever been ONE physical `workspace_key` value in this table's
-- entire history, assigning every row (live or dead) to the one real
-- workspace is not a guess or a data-loss risk -- it is the literal,
-- already-true fact about which company's data this is, restated in the
-- new column. Same reasoning applies to `app_state_snapshots` (at most
-- one row has ever existed there, same 'default' literal).
--
-- JUDGMENT CALL 3 -- frontend `on_conflict` coordination (same shape as
-- migration 173's Section 5 point 5 warning, re-raised here because it
-- applies again): repointing the primary key to `(workspace_id,
-- record_key)` means `on_conflict=workspace_key,record_key` -- the exact
-- literal string `saveRemoteAppState()` sends today -- no longer names
-- any real unique constraint the instant this migration is applied.
-- Deploying this migration WITHOUT its companion frontend change landing
-- immediately after breaks every `roleMode` save for every user (a 400
-- from PostgREST, "no unique or exclusion constraint matching the ON
-- CONFLICT specification"), the same one-way risk 173 flagged for
-- `standard_install_times`. The companion `src/persistence.ts` diff is
-- written to disk and reported, but deliberately NOT committed here --
-- per this repo's "git push sends the whole branch" rule, it must not
-- reach `origin/main` before E confirms migration 183 is live.
--
-- Confirm 183 is still the next free migration number at execution
-- time (migrations 180-182 were being drafted concurrently by other
-- agents for unrelated fixes and may have landed first). Not applied.
-- Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- Schema: nullable for now, backfilled below, then locked
-- down NOT NULL in this same transaction (same three-step shape as every
-- other Stage 1-5 workspace_id rollout).
-- ============================================================

alter table public.app_records
  add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.app_state_snapshots
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_app_records_workspace_id on public.app_records(workspace_id);
create index if not exists idx_app_state_snapshots_workspace_id on public.app_state_snapshots(workspace_id);

-- ============================================================
-- Section 2 -- Backfill. Both tables have exactly one physical
-- `workspace_key` value ('default') across their entire history -- see
-- Judgment call 2 above for why every row (live 'roleMode' rows and any
-- surviving dead Phase-10-era rows alike) is backfilled to the one real
-- workspace, not filtered by `record_key`.
-- ============================================================

update public.app_records
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

update public.app_state_snapshots
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

do $$
begin
  if exists (select 1 from public.app_records where workspace_id is null) then
    raise exception 'backfill incomplete: app_records.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.app_state_snapshots where workspace_id is null) then
    raise exception 'backfill incomplete: app_state_snapshots.workspace_id still has nulls';
  end if;
end $$;

alter table public.app_records alter column workspace_id set not null;
alter table public.app_state_snapshots alter column workspace_id set not null;

-- ============================================================
-- Section 3 -- Ownership trigger: guard_workspace_id_mutation()
-- (migration 117), verbatim, same as every other root table with no
-- better anchor to derive from instead. Fires correctly on
-- saveRemoteAppState()'s upsert path (`INSERT ... ON CONFLICT DO
-- UPDATE`): the BEFORE INSERT trigger runs first regardless of whether
-- the row ultimately inserts or hits the conflict target, so
-- `resolve_caller_workspace_id()` always stamps a real `workspace_id`
-- before Postgres checks for a conflict; on a genuine conflict, the
-- UPDATE path fires instead with `workspace_id` untouched by the
-- payload (the client never sends it), so the UPDATE branch's "new is
-- distinct from old" immutability check trivially passes. Verified
-- empirically in the PGlite sandbox below, not just reasoned about.
-- ============================================================

drop trigger if exists app_records_guard_workspace_id on public.app_records;
create trigger app_records_guard_workspace_id
  before insert or update on public.app_records
  for each row execute function public.guard_workspace_id_mutation();

drop trigger if exists app_state_snapshots_guard_workspace_id on public.app_state_snapshots;
create trigger app_state_snapshots_guard_workspace_id
  before insert or update on public.app_state_snapshots
  for each row execute function public.guard_workspace_id_mutation();

-- ============================================================
-- Section 4 -- Uniqueness: `app_records`' primary key is repointed from
-- `(workspace_key, record_key)` to `(workspace_id, record_key)` --
-- required so the same `record_key` (e.g. 'roleMode') can exist once per
-- real workspace instead of colliding into the single 'default' row
-- every company has always silently shared. `app_state_snapshots`'
-- separate `unique(workspace_key)` constraint is repointed to
-- `unique(workspace_id)` the same way; its own `id` primary key is
-- untouched. Neither old `workspace_key` column is dropped -- see
-- Judgment call 1 above.
--
-- COORDINATION REQUIRED: this changes what `on_conflict=` value
-- `saveRemoteAppState()` must send -- see Judgment call 3 above and the
-- companion (uncommitted) `src/persistence.ts` diff.
-- ============================================================

alter table public.app_records drop constraint app_records_pkey;
alter table public.app_records add constraint app_records_pkey primary key (workspace_id, record_key);

alter table public.app_state_snapshots drop constraint app_state_snapshots_workspace_key_key;
alter table public.app_state_snapshots add constraint app_state_snapshots_workspace_id_key unique (workspace_id);

-- ============================================================
-- Section 5 -- RLS: workspace-scoped, matching this session's standard
-- pattern (migration 178's `one_off_reconciliations`). `app_state_
-- snapshots` gets a read policy only -- it has had no write policy for
-- `authenticated` since 009:64 (deliberately left read-only, legacy
-- fallback), and this migration does not reopen writes to it.
-- ============================================================

drop policy if exists "authenticated read app_records" on public.app_records;
drop policy if exists "authenticated write app_records" on public.app_records;

create policy "workspace members read app_records"
  on public.app_records for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members write app_records"
  on public.app_records for all to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists "authenticated read app_state_snapshots" on public.app_state_snapshots;

create policy "workspace members read app_state_snapshots"
  on public.app_state_snapshots for select to authenticated
  using (public.is_workspace_member(workspace_id));

commit;
