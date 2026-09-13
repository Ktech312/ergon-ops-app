# Support/Service Module — First Design (Queue B7, NOT IMPLEMENTED)

Status: **DESIGN ONLY. No production code, no migration, no permissions/workflow decisions made.**
Written for `CONTINUOUS_CODER_HANDOFF.md` Queue B7. The `support` role key already exists in
`app_user_roles` (migration 040) and already gates a real, if minimal, permission today (Inventory
view-only, `main.tsx:10106`/`10118`) — this is that role's first actual module, not a new role
concept. Ties to decision **D13** (§8 of that document, "Support first release: ticket/request
lifecycle linked to Client Ledger, Project, site, and installed asset") — this document is the
detailed version of that one-line recommendation.

## 1. What already exists (do not re-build)

- **Entry point data**: `projects` (status, `warranty_expiration_date`, `added_to_ledger`,
  `ledger_bucket` — migrations 064/089/090), `installed_assets` (`project_id`,
  `project_location_id`, `catalog_item_id`, `serial_number`, `install_date` — migration 089), and
  `CatalogItem.expectedLifespanYears` (migration 089) already give a support case everything it needs
  to show "this client, this site, this specific installed unit, installed on this date, warranty
  status X" without a single new join concept — all three already relate through real foreign keys.
- **Status/version lifecycle precedent**: `project_submittals` (migration 025) already models
  `status` (`draft`/`sent`/`approved`/`rejected`/`revision_requested`), `version`, and response
  tracking — the closest existing precedent for a record that moves through states over time with a
  client-visible side. A support ticket's own status lifecycle should follow the same shape
  discipline (a `text` + `check` constraint enum, not a separate lookup table), not invent a new
  pattern.
- **Role**: `support` already exists (migration 040) with exactly one permission today
  (`rolePermissions.support = ["View only"]`, Inventory only). This module is where that role
  finally gets something to *do* beyond viewing stock.

## 2. Entry from a closed Project / Client Ledger record

A support case is created from an existing Client Ledger entry (`projects.added_to_ledger = true`) —
not from scratch, and not from an open/in-progress project. The Client Ledger detail panel (already
built, Queue A-era) gains a "New Support Case" action alongside its existing kickoff/warranty/
hardware sections. Creating a case pre-fills client/site/project context and offers the project's
`installed_assets` as pickable context (zero or more — a case isn't always about one specific unit;
"the whole site's network is down" has no single asset to point at).

## 3. Proposed schema (illustrative — not a migration)

```sql
-- Confirm the next free migration number at execution time.
create table support_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,  -- e.g. "SC-2026-0001", same generated-ref convention as
                                      -- quotes (SQ-####) and projects (PRJ-####)
  project_id uuid not null references projects(id),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'waiting_on_client', 'resolved', 'reopened', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  -- SLA is a target, not a hard gate this pass -- see §6, D13 doesn't ask
  -- for enforcement, only visibility.
  sla_due_at timestamptz,
  owner_workspace_member_id uuid references workspace_members(id),
  summary text not null,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz
);

create table support_case_assets (
  support_case_id uuid not null references support_cases(id) on delete cascade,
  installed_asset_id uuid not null references installed_assets(id),
  primary key (support_case_id, installed_asset_id)
);

create table support_case_activity (
  id uuid primary key default gen_random_uuid(),
  support_case_id uuid not null references support_cases(id) on delete cascade,
  kind text not null check (kind in (
    'note', 'status_change', 'client_communication', 'scheduled_visit', 'parts_used', 'reopened'
  )),
  body text,
  actor_email text,
  occurred_at timestamptz not null default now(),
  -- Only populated for kind = 'parts_used' -- links to the same inventory
  -- deduction path Projects already use, not a parallel one.
  inventory_item_ref text references inventory_items(ref),
  qty numeric(10,2)
);
```

`support_case_activity` is one append-only timeline table for notes, status changes, client
communication log, scheduled maintenance visits, and parts/labor entries — matching this app's
existing convention of one activity/audit table per entity (e.g. `task_activity`) rather than a
separate table per activity type.

## 4. Ownership, priority/SLA, client communication

- **Ownership**: `owner_workspace_member_id`, reassignable, defaulting to whoever created the case.
  Matches the same `workspace_members`-backed ownership model already decided for Share-link Stage 2
  (`PRODUCT_STAGE2_SCHEMA_PLAN.md`'s `assigned_pm_workspace_member_id`) — reusing that shape rather
  than inventing a second one for Support.
- **Priority/SLA**: a target due date computed from priority (not decided here — a specific SLA
  matrix, e.g. "urgent = 4 business hours," is a business decision, not an implementation one).
  Visibility-only this pass: a case past `sla_due_at` shows a plain visual flag; there is no
  enforcement action (no auto-escalation, no auto-notification) until that's explicitly decided —
  matching D13's own framing as "linked... lifecycle," not "linked... enforcement."
- **Client communication**: logged as `support_case_activity` rows (`kind = 'client_communication'`),
  written manually by the case owner today — an actual outbound-email integration (vs. a manual log
  entry) is a separate, larger decision (mirrors the same email-sending infrastructure already used
  for proposals/submittals, `api/send-proposal-email.js` et al., and could reuse it) not decided here.

## 5. Scheduled maintenance, parts/labor, resolution, reopen

- **Scheduled maintenance**: an activity row (`kind = 'scheduled_visit'`) with a future `occurred_at`
  — deliberately not a new calendar/scheduling system; if this app already has a scheduling surface
  elsewhere (migration 025's header mentions "scheduling templates"), that should be traced and reused
  before inventing a second one, not assumed identical here.
- **Parts/labor**: `parts_used` activity rows deduct inventory via the same write path Projects
  already use for transfers (not a new deduction mechanism) — labor (hours) is a plain numeric note
  field on the same row type, not a separate timesheet system.
- **Resolution**: `status = 'resolved'` sets `resolved_at`; **reopen** is a distinct, logged transition
  (`kind = 'reopened'` activity row) back to `in_progress`, not a silent status flip — matching the
  same "distinct, auditable transition" discipline already established for share-link disable-vs-
  revoke (Queue B3) and proposal response states.
- **Closed** is a separate, later state from `resolved` — a resolved case can still be reopened; a
  closed one represents "this is done and won't be reopened," mirroring the distinction already made
  between a project's `status` and its Client Ledger `ledger_bucket`.

## 6. What remains genuinely open (not decided here)

- Exact SLA matrix (priority → target hours) — a business decision.
- Whether client communication should send real email (reusing existing mailer infra) or stay an
  internal log only, in this first release.
- Whether `support` should gain write access to `installed_assets`/Client Ledger fields directly, or
  stay read-only there while owning `support_cases` itself — a role/permission question, explicitly
  not decided here per the task's own instruction ("do not implement permissions... before review").
- Whether Support cases need their own client-facing share-link/portal (à la proposals/submittals) —
  not scoped in D13's recorded direction; flagged as a possible later phase, not proposed here.

## 7. Smallest useful first release

Create a case from a Client Ledger project, list/filter cases by status/owner/priority, log activity
(notes, status changes, parts used), resolve/reopen. No SLA enforcement, no client-facing portal, no
scheduling integration beyond a plain future-dated activity note. This is deliberately smaller than
the full schema in §3 — `support_case_activity`'s `kind` enum already accommodates the fuller feature
set so later phases are additive, not a redesign.
