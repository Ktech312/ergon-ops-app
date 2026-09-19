// Consolidated cross-workspace isolation suite.
//
// Applies the ENTIRE real migration history (backend/supabase/migrations/
// 001...185, every file, verbatim, unmodified on disk) to one fresh
// PGlite (embedded real-Postgres) instance, ONCE, then runs every existing
// canonical migration_N_..._tests.sql file against that SAME, fully
// migrated instance, in migration-number order, sequentially.
//
// This is the piece of test infrastructure that individual per-migration
// verification passes could never provide on their own: each of those
// only ever proved its own migration's isolation logic against a
// hand-built PARTIAL schema. This suite proves all of them still hold
// together against the real, complete, current 185-migration schema in
// one shot -- exactly the shape of bug an interaction between two
// migrations' worth of state can produce and single-migration testing
// cannot catch (see PRODUCT_MASTER_COMPLETION_PLAN.md Stage 6, and the
// migration-173/event_type precedent documented in this suite's README
// comments below).
//
// Usage:
//   node backend/supabase/consolidated_isolation_suite/run_all.mjs
//
// Exit code is non-zero if any test file failed, so this can be wired
// into CI later.

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SUPABASE_DIR = path.join(REPO_ROOT, 'backend', 'supabase');
const MIGRATIONS_DIR = path.join(SUPABASE_DIR, 'migrations');
const SUITE_DIR = __dirname;

// ---------------------------------------------------------------------
// Sandbox-only patches to the IN-MEMORY SQL text of two real, already-
// applied migration files, applied only inside this bootstrap script --
// the actual committed files on disk are never modified. This is not a
// new finding: it is a pre-existing, already-documented production issue
// (see HANDOFF.md, migration 095/108 entries). Migration 095's
// notification_rules.event_type CHECK constraint list, as originally
// written, silently dropped four values that migrations 046/049/054 had
// already added by the time 095 ran -- production hit this exact
// constraint violation live and fixed it with a manually corrected
// re-run, never captured as an edit to the 095 file itself (this repo's
// standing discipline is to never edit an applied migration file).
// Replaying 095 verbatim from a fresh database hits the identical
// failure; these patches reconstruct the REAL post-fix live state so the
// full replay can proceed, exactly as scratchpad/pgtest/run.mjs already
// established and validated earlier this session.
// ---------------------------------------------------------------------
const SANDBOX_PATCHES = {
  '108_mentioned_notification_event.sql': (sql) => {
    const from = `check (event_type in (
  'task_assigned', 'task_overdue', 'task_status_changed',
  'purchase_request_status_changed', 'build_stage_changed',
  'submittal_responded', 'low_stock_reached',
  'catalog_price_change_requested', 'catalog_price_change_reviewed',
  'user_signup_pending', 'quote_proposal_responded',
  'mentioned'
));`;
    const to = `check (event_type in (
  'task_assigned', 'task_overdue', 'task_status_changed',
  'purchase_request_status_changed', 'build_stage_changed',
  'submittal_responded', 'low_stock_reached', 'direct_message_received',
  'catalog_price_change_requested', 'catalog_price_change_reviewed',
  'user_signup_pending', 'quote_proposal_responded',
  'mentioned'
));`;
    if (!sql.includes(from)) throw new Error('SANDBOX_PATCHES[108] no longer matches the file on disk -- update or remove this patch');
    return sql.replace(from, to);
  },
  '095_push_subscriptions.sql': (sql) => {
    const from = `check (event_type in (
    'task_assigned', 'task_overdue', 'task_status_changed',
    'purchase_request_status_changed', 'build_stage_changed',
    'submittal_responded', 'low_stock_reached', 'direct_message_received'
  ));`;
    const to = `check (event_type in (
    'task_assigned', 'task_overdue', 'task_status_changed',
    'purchase_request_status_changed', 'build_stage_changed',
    'submittal_responded', 'low_stock_reached', 'direct_message_received',
    'catalog_price_change_requested', 'catalog_price_change_reviewed',
    'user_signup_pending', 'quote_proposal_responded'
  ));`;
    if (!sql.includes(from)) throw new Error('SANDBOX_PATCHES[095] no longer matches the file on disk -- update or remove this patch');
    return sql.replace(from, to);
  },
};

function log(msg) {
  console.log(msg);
}

async function applyFile(db, label, sql) {
  await db.exec(sql);
  log(`  OK    ${label}`);
}

function discoverMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f) && !f.endsWith('_tests.sql'))
    .map((f) => ({ file: f, n: parseInt(f.split('_')[0], 10) }))
    .sort((a, b) => a.n - b.n);
}

// Discover canonical test files under BOTH naming conventions used across
// this repo's history: backend/supabase/migration_N_..._tests.sql (the
// vast majority) and backend/supabase/migrations/N_..._tests.sql (early
// variants, if any exist alongside the real migration files).
function discoverTests() {
  const results = [];

  for (const f of readdirSync(SUPABASE_DIR)) {
    if (!f.endsWith('_tests.sql')) continue;
    const m = f.match(/^migration_(\d+)_/);
    if (!m) continue;
    results.push({ file: f, dir: SUPABASE_DIR, n: parseInt(m[1], 10) });
  }

  for (const f of readdirSync(MIGRATIONS_DIR)) {
    if (!f.endsWith('_tests.sql')) continue;
    const m = f.match(/^(\d+)_/);
    if (!m) continue;
    results.push({ file: f, dir: MIGRATIONS_DIR, n: parseInt(m[1], 10) });
  }

  results.sort((a, b) => a.n - b.n || a.file.localeCompare(b.file));
  return results;
}

async function main() {
  const db = new PGlite({ extensions: { pgcrypto } });

  log('=== Consolidated cross-workspace isolation suite ===');
  log('');
  log('--- Stage 1: platform stub (auth/storage schemas, roles, grants) ---');
  await applyFile(db, 'platform_stub.sql', readFileSync(path.join(SUITE_DIR, 'platform_stub.sql'), 'utf8'));

  log('');
  log('--- Stage 2: seed fixture (one real admin account row) ---');
  await applyFile(db, 'seed_fixture.sql', readFileSync(path.join(SUITE_DIR, 'seed_fixture.sql'), 'utf8'));

  log('');
  log('--- Stage 3: full real migration history (001...185) ---');
  const migrations = discoverMigrations();
  log(`  discovered ${migrations.length} migration files (${migrations[0].file} .. ${migrations[migrations.length - 1].file})`);

  // Applied interleaved at a specific, safe point in the real migration
  // sequence -- see seed_fixture_roles.sql's own header for exactly why
  // migration 040 is the right point (first shape of app_user_roles that
  // has everything these inserts need, well before migration 115's real
  // workspace_members/workspace_member_roles backfill consumes them).
  const AFTER_MIGRATION_HOOKS = {
    40: { label: 'seed_fixture_roles.sql', path: path.join(SUITE_DIR, 'seed_fixture_roles.sql') },
  };

  for (const { file, n } of migrations) {
    const fullPath = path.join(MIGRATIONS_DIR, file);
    let sql = readFileSync(fullPath, 'utf8');
    let label = file;
    if (SANDBOX_PATCHES[file]) {
      sql = SANDBOX_PATCHES[file](sql);
      label += ' (sandbox-patched -- see SANDBOX_PATCHES comment in this script; real file on disk is untouched)';
    }
    try {
      await applyFile(db, label, sql);
    } catch (e) {
      log('');
      log('!!! STOP: a REAL migration file failed to apply during full replay. !!!');
      log(`!!! File: ${file}`);
      log(`!!! Error: ${String(e && e.message ? e.message : e)}`);
      log('!!! This is either a genuine bug in the migration itself, or this');
      log('!!! bootstrap is missing a stub/seed dependency the migration assumes.');
      log('!!! Per task discipline: do NOT silently patch the migration file.');
      log('!!! Investigate and report before proceeding.');
      await db.close();
      process.exit(1);
    }

    const hook = AFTER_MIGRATION_HOOKS[n];
    if (hook) {
      await applyFile(db, hook.label, readFileSync(hook.path, 'utf8'));
    }
  }

  log('');
  log(`--- Stage 4: running all canonical isolation tests against the SAME fully-migrated instance ---`);
  const tests = discoverTests();
  log(`  discovered ${tests.length} canonical test files`);
  log('');

  const results = [];
  for (const { file, dir, n } of tests) {
    const fullPath = path.join(dir, file);
    const sql = readFileSync(fullPath, 'utf8');
    const notices = [];
    let status = 'PASS';
    let errorMessage = null;

    try {
      await db.exec(sql, { onNotice: (notice) => notices.push(notice.message || String(notice)) });
    } catch (e) {
      status = 'FAIL';
      errorMessage = String(e && e.message ? e.message : e);
    } finally {
      // Defensive reset: guarantee the shared connection is back to a
      // clean, non-aborted transaction state before the next test file
      // runs, regardless of whether this file's own trailing `rollback;`
      // was reached (a mid-transaction error can prevent later
      // statements in the same file from executing at all).
      try {
        await db.exec('rollback;');
      } catch (_) {
        /* no transaction in progress -- fine */
      }
    }

    if (status === 'PASS') {
      const passNotice = notices.find((m) => /ALL MIGRATION \d+.*PASSED/i.test(m));
      if (!passNotice) {
        status = 'FAIL';
        errorMessage =
          'exec() completed without error, but no "ALL MIGRATION N ... PASSED" notice was observed -- ' +
          'the file may have exited early without reaching its own final assertion.' +
          (notices.length ? ` Notices seen: ${JSON.stringify(notices)}` : ' No notices were emitted at all.');
      }
    }

    results.push({ n, file, status, errorMessage, notices });
    log(`  ${status === 'PASS' ? 'PASS' : 'FAIL'}  migration ${n}  ${file}`);
    if (status === 'FAIL') {
      log(`        ${errorMessage}`);
    }
  }

  await db.close();

  const passed = results.filter((r) => r.status === 'PASS');
  const failed = results.filter((r) => r.status === 'FAIL');

  log('');
  log('=== SUMMARY ===');
  log(`Total canonical test files run: ${results.length}`);
  log(`Passed: ${passed.length}`);
  log(`Failed: ${failed.length}`);

  if (failed.length > 0) {
    log('');
    log('--- Failures ---');
    for (const r of failed) {
      log(`migration ${r.n} (${r.file}):`);
      log(`  ${r.errorMessage}`);
    }
  }

  log('');
  if (failed.length > 0) {
    log('RESULT: FAIL');
    process.exitCode = 1;
  } else {
    log('RESULT: ALL PASSED');
    process.exitCode = 0;
  }
}

main().catch((e) => {
  console.error('Unexpected orchestrator error:', e);
  process.exitCode = 1;
});
