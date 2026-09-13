# Security & Dependency Follow-Up (Queue B10, 2026-09-12)

Status: **READ-ONLY AUDIT. Nothing installed, removed, upgraded, or migrated.** Written for
`CONTINUOUS_CODER_HANDOFF.md` Queue B10. Ties to decision **D6** (§8, `xlsx` dependency — evaluation
already recommends `exceljs`, no decision made). Findings only, per the task's own instruction; any
database fix stays a manual migration package, and no package is installed or replaced here.

## 1. Dependency audit refresh

### 1.1 `xlsx` finding — revalidated, unchanged

Re-grepped the entire repository for every `XLSX.`/`from "xlsx"`/`exceljs` reference. **Still exactly
two call sites**, same pattern as `PRODUCT_XLSX_REPLACEMENT_EVALUATION.md` already found — only their
line numbers shifted with the file's growth this session: `handleBomFileSelect`
(`src/main.tsx:12276`/`:12278`, was `:11903`) and `handleCatalogFileSelect`
(`src/main.tsx:19295`/`:19297`, was `:18693`). `package.json` still pins `xlsx: ^0.18.5`; no
`exceljs` present. **The existing recommendation stands unchanged: migrate to `exceljs`.** Nothing in
this pass's own work touched either call site or introduced a third one.

### 1.2 Fresh `npm audit` — six additional advisories not in the last audit doc

`npm audit --omit=dev` (read-only, nothing installed):

| Package | Severity | Fix available (non-breaking) |
|---|---|---|
| `xlsx` | high (Prototype Pollution, ReDoS) | **No** — capped at 0.18.5 on npm indefinitely, matches the existing evaluation exactly |
| `nodemailer` | high (4 advisories: `disableFileAccess`/`disableUrlAccess` bypass via legacy signature, IDN/punycode domain allow-list bypass, O(n²) address-parser DoS, RFC 5322 comment-parsing domain-validation bypass) | Yes |
| `pdfjs-dist` | high (arbitrary JS execution on a malicious PDF) | Yes |
| `nanoid` | high (custom generator loops indefinitely at size 0) | Yes |
| `postcss` | moderate (incomplete fix of a prior sourceMappingURL advisory) | Yes |
| `browserslist` | high | Yes |
| `baseline-browser-mapping` | moderate | Yes |

**`nodemailer` is worth flagging above the others**: this app's own mailer (`api/_lib/mailer.js`,
used by every proposal/submittal/notification email path) depends on it directly, and two of its four
advisories (the domain-validation/allow-list bypasses) are specifically about email being
misdelivered to an attacker-controlled domain — directly relevant to a real send path, not just a
theoretical dependency-tree risk. `pdfjs-dist`'s "arbitrary JS execution on a malicious PDF" is worth
checking against wherever this app renders an uploaded/received PDF client-side (not traced in this
pass — a candidate for the next audit refresh if this app does render third-party PDFs anywhere
today). All six report `fixAvailable: true` (npm's own signal for an ordinary, non-breaking
semver-range bump, not a `--force` major-version jump) — **not run here**, since installing/updating a
package is explicitly out of scope for this pass; flagged for E to run `npm audit fix` at their own
discretion.

## 2. Security-definer function review — every function added or redefined since the last audit

The last broad authorization-helper audit is `PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md`
§13.2. Since then, seven `security definer` functions were created or redefined across migrations
127–134 (all from this session's own earlier work): `create_project_from_quote` (127, redefined
again in 134), `assign_project_ref`/`create_project_channel` (128), `save_equipment_recipe` (130),
`replace_project_bom_lines` (131, redefined in 132), `bridge_set_primary_role` (133, redefined from
its 124 original). Checked each against the four criteria this task names:

- **`search_path = ''`**: all seven set it explicitly. No exceptions found.
- **Fully qualified references**: spot-checked across all seven (`public.app_user_roles`,
  `public.workspace_members`, `public.is_app_admin`, `public.active_workspace_id()`, etc.) — every
  table/function reference inside these bodies is schema-qualified. No exceptions found.
- **Minimum grants**: all seven `revoke all ... from public`, `revoke execute ... from anon`, then
  `grant execute ... to authenticated` only — except `assign_project_ref`/`create_project_channel`
  (migration 128), which correctly revoke from `authenticated` too, since both are trigger-only and
  were never meant to be directly callable at all. No over-broad grant found.
- **Safe errors**: every `raise exception` message checked in these seven bodies is a plain,
  user-safe sentence (e.g. `bridge_set_primary_role`'s `'Only an admin or manager may change a
  user''s primary role.'`) — none leak a table name, constraint name, or raw Postgres error text.

**No new gap found in any of the seven.** This is a clean result, not an absence of looking — every
one of the four criteria was checked against the real current SQL, not assumed from the migrations'
own commentary.

### 2.1 `has_role()` — still open, unchanged since the last audit, correctly avoided everywhere new

`has_role(check_role text)` (migration 023) remains exactly as unhardened as migration 124's own
header already flagged: `language sql`, no `set search_path`, and an unqualified
`from app_user_roles` reference — confirmed by reading its current, only definition (never
redefined since 023). This is a **restated, not new**, finding.

What *is* new this pass: every one of the seven functions in §2 was checked for whether it calls
`has_role()` internally, and **none of them do** — each has an explicit code comment naming exactly
why (the "nested unhardened helper inside a hardened `search_path=''` function" risk migration 124
was written to close). `migration 133`'s `bridge_set_primary_role` in particular inlines the
equivalent check by hand, fully qualified, specifically to avoid calling it. This confirms the
discipline established after the risk was first identified has held consistently across every new
function since — a positive result worth recording, not just the gap itself.

### 2.2 Public/anon-facing RPC surface — unchanged since the last audit

None of migrations 127–134 grant `execute` to `anon` on anything — every new/redefined function in
this window is `authenticated`-only or trigger-only. The genuinely public, anon-callable surface
(`get_quote_proposal_by_token`, `respond_to_proposal`, `get_submittal_by_token`,
`respond_to_submittal`, migrations 119/122) is untouched since the last audit and was not re-derived
here — nothing changed there to review.

## 3. What this document deliberately does not do

It does not run `npm audit fix`, does not install or replace `xlsx`, `exceljs`, or any other package,
and does not draft or run a migration for `has_role()` — hardening it (adding `search_path=''` and
qualifying its one table reference) would be a purely additive, zero-behavior-change fix in principle,
but per the task's own instruction any database fix stays a manual migration package for review, not
applied here. It does not trace every call site of `has_role()` across all RLS policies — that is a
larger, separate sweep beyond "functions added since the last audit," which is what this pass scoped
itself to.
