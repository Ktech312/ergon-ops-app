# Ergon Ops — Share-Token, Backup, Hardcoded-Content & Test-Coverage Audit

Priority 8 (part 2) of the 2026-09-08 overnight work queue. Read-only — no files modified, no
production system exercised. All line numbers verified by direct read at audit time. Context from
`PRODUCT_PHASE2_PLAN.md` §2.2/§3.3 and `HANDOFF.md`'s latest work-log entries read first, not
re-derived below — cited where relevant.

---

## Part A — Public share-token behavior audit

### A1. Token entropy

Generated client-side by `generateShareToken()` (`src/persistence.ts:3686-3691`):

```js
function generateShareToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
```

- **Primary path**: two concatenated `crypto.randomUUID()` values (CSPRNG-backed, ~244 bits
  combined) → a 64-hex-char token. Cryptographically adequate.
- **Fallback path**: if `crypto.randomUUID` is unavailable, the token is built from `Math.random()`
  + `Date.now()` — not cryptographically secure. Low practical likelihood on a modern HTTPS
  deployment, but the fallback is a latent gap since nothing detects or warns when it's used.
- Used identically for both quote-proposal tokens and submittal tokens.

### A2. Expiration — set vs. checked

**Checked**: both RPCs do check it —
`backend/supabase/migrations/053_sales_quote_proposals.sql:164,187`:
```sql
and (t.expires_at is null or t.expires_at > now());
```

**Never set**: `public_share_tokens.expires_at` is nullable with **no default**
(`025_phase11_scheduling_templates_submittals.sql:99`). The only writer,
`createQuoteProposalShareToken` (`persistence.ts:10501-10515`), POSTs only
`{ token, entity_type, entity_id }` — `expires_at` is never included. Same for
`createSubmittalShareToken`.

**Net effect**: every token issued is permanently null-`expires_at`, so the check clause always
evaluates true. The mechanism exists and is correctly wired in SQL, but is **completely inert in
practice** — proposal and submittal links never expire. Contrast with `user_invites.expires_at`,
which has a real `default (now() + interval '30 days')` — the pattern for a real default exists
elsewhere in this codebase but wasn't applied here.

### A3. Reuse — can the same token respond more than once? **Yes — a real gap.**

`respond_to_quote_proposal` (`053_sales_quote_proposals.sql:169-205`) has no status-transition
guard on its `UPDATE`:

```sql
update sales_quote_proposals
set status = new_status, responded_at = now(), response_notes = notes,
    approval_name = approver_name, approval_ip = approver_ip,
    approval_content_hash = encode(sha256(snapshot::text::bytea), 'hex'), updated_at = now()
where id = target_id;
```

No `and status = 'sent'` (or similar) precondition — the RPC will overwrite an already-`approved`
proposal to `rejected` or vice versa, any number of times, each call silently clobbering the prior
`responded_at`/`approval_name`/`approval_ip`/`response_notes`/`approval_content_hash`.

The only prevention is client-side UI: `ProposalPublicPage` only renders the response form when
`phase === "ready"` (requires `status === "sent"`); once responded, it flips to a read-only
banner. **This is a UI-only gate** — calling the RPC directly (anyone with the token and knowledge
of the PostgREST `rpc/respond_to_quote_proposal` endpoint) bypasses it entirely, since the RPC
itself performs no server-side idempotency/status check. Genuine reuse gap, not theoretical.

### A4. Revocation — none exists

Repo-wide search for any `DELETE` against `public_share_tokens` or any revoke path returns
nothing — the only operations against that table anywhere in application code are the two `POST`
inserts and two `SELECT`s used to read a token back for display. No UI control, no RPC, no admin
action invalidates a token before its (in practice never-reached) expiration. Combined with A2,
an issued proposal or submittal link is **permanent** for the life of the underlying row.

### A5. Suspended workspace — confirmed, not re-derived

`PRODUCT_PHASE2_PLAN.md` §3.3 already states this explicitly: neither RPC checks workspace
`status`, and it's flagged "required before Phase 3 is considered complete," not yet closed.
Practical severity today is low only because RLS/workspace enforcement doesn't exist anywhere
yet — the gap is real and already tracked, not newly discovered here.

### A6. Logging — none exists

No access logging exists at any layer for token use. `fetchPublicQuoteProposal()` is a bare fetch
to the RPC with no write-back. `approver_ip` is hardcoded to `""` at the call site
(`persistence.ts:10565`) — so even the one column the schema provides for capturing an IP
(`sales_quote_proposals.approval_ip`) is never populated. No `deletion_log`-style or dedicated
access table exists for `public_share_tokens` (confirmed via grep for `access_log`/`audit_log`/
`token_access`/`viewed_at` across all migrations). There is no record of who viewed a public
proposal link, when, or from where — only a final response (if one occurs) is persisted, and even
that carries no real IP.

### A7. Rate limiting — not rate-limited at all

`fetchPublicQuoteProposal`/`respondToPublicQuoteProposal` call Supabase PostgREST RPC endpoints
directly from the browser — never through any `api/*.js` route. `api/_lib/rateLimit.js`'s
`checkRateLimit()` is wired into exactly 8 routes, none of which is the public token-view/respond
path. The only rate limiting on this anonymous, unauthenticated surface, if any, is whatever
Supabase's own infrastructure-level rate limiting provides (not configurable or visible from this
repo). Real gap: the most attractive unauthenticated target (repeatedly guessing/hammering a
proposal token, or spamming `respond_to_quote_proposal` given A3's reuse gap) has zero app-layer
throttling.

### A8. Data exposed in snapshots

`buildProposalSnapshot()` constructs `content_snapshot` from client name, site name, city, quote
ref, proposal summary, full BOM (item/product name, qty, notes, description, manufacturer,
datasheet URL, product image URL), and full template sections.

- **Pricing is deliberately excluded** — confirmed intentional (`053_sales_quote_proposals.sql:144-146`
  comment: "never quote internal cost/markup data").
- `client_email` is on the proposal row but the public RPC's return list doesn't include it — not
  leaked through the token.
- What **is** exposed to anyone holding the (never-expiring, unrevocable, unlogged) link: client
  name, site address/city, the full equipment BOM with product images and datasheet links, and
  exec-summary text. For a security/surveillance-hardware business, this is meaningful
  competitive/reconnaissance information about a specific customer's real site — not pricing, but
  real site-design intel. Given A2/A3/A4/A6/A7 together, the token's actual protection level is:
  **an unguessable, unrevocable, forever-valid, unlogged, unrate-limited bearer credential** — a
  materially weaker posture than the data being shared would suggest is appropriate, even though
  none of these gaps was introduced carelessly (several are already tracked as pre-Phase-3 work).

---

## Part B — Data export, backup, restoration, and retention audit

### What exists today

- **Per-view CSV export only**, not a full data export. `exportCsv()` is a pure client-side
  helper serializing already-loaded rows into a downloaded `Blob` — no server involvement, no
  "export everything" scope. Wired into Inventory, Purchase Request queue, Movement Ledger, and
  Reports. No admin-facing "export my workspace's full data" feature exists.
- **No documented Supabase backup/restore process.** `backend/docs/supabase-production-handoff.md`
  (74 lines, read in full) covers project identity, env vars, and the manual migration process,
  but contains **zero** mention of backup, restore, PITR, retention, or RPO/RTO. The doc is also
  stale — references migrations only through `068`, while the repo now has 118.
- Supabase provides automated backups/PITR at the infrastructure level (a platform capability),
  but **nothing in this repo documents what tier is enabled, what the retention window is, or
  that anyone has ever tested a restore.** A real, silent single point of failure risk for a
  product being positioned as sellable/multi-tenant.
- **Soft-delete + `deletion_log`, but no real retention/purge policy.** Migration 088's own
  comment states the design explicitly: "the data itself stays in place until someone restores it
  or an admin permanently purges it by hand." No scheduled job, cron route, or admin UI for a
  time-based purge was found. In practice, soft-deleted rows are retained **forever**, with no
  documented statement that's the intent versus an oversight.
- No privacy policy, ToS, GDPR, or data-retention-policy language exists anywhere in the repo.

### Gaps relative to a sellable, multi-tenant SaaS product

1. **No per-workspace data export** — once multi-tenancy is real, a departing customer has no way
   to get their data out.
2. **No documented RPO/RTO.**
3. **No tested restore procedure** — no "if the database needs restoring, here's how" runbook.
4. **No retention/purge policy for soft-deleted data** — both a cost dimension (unbounded row
   growth) and a compliance dimension (a customer's "delete my data" request currently only
   soft-deletes; the underlying row persists indefinitely).
5. **The one existing infra doc is stale** and would mislead a new developer about migration count.

None of the above is a code bug — a documentation/process gap, appropriate to flag for planning
rather than fix silently.

---

## Part C — Hard-coded content audit (beyond tonight's already-fixed items)

Tonight's already-fixed baseline (not re-flagged): dead client-data array, Emerald Queen fallback
(both `main.tsx` and `api/sales-quote-extract.js`), hardcoded-2026 `nextProjectRef()` year bug —
verified clean (no residual hits for the real names/addresses anywhere in `src/`/`api/`).

### New findings — genuine cleanup candidates

1. **A second dead hardcoded array, same class as the one already fixed — not caught tonight.**
   `const parts: Part[] = [...]` at `src/main.tsx:649-760` (32 items, SKU-0001 through SKU-0032).
   A top-level array containing real Ergon/EnSight inventory catalog data: real part numbers,
   real vendor names (FriendlyElec, Amazon, NewEgg), real Amazon purchase-link URLs with tracking
   params, and real internal unit-cost figures with date-stamped price history. **Confirmed
   dead**: exhaustive grep for every plausible reference pattern returns zero hits outside the
   declaration — every other `.parts` occurrence is an unrelated object property built from real
   `inventoryItems` state that happens to share the name. Unlike the previously-fixed items, this
   isn't a third-party-identity leak — it's Ergon's own real cost/vendor data — but it is real
   proprietary business data (internal purchasing costs) shipping unused in the public production
   JS bundle, readable by anyone via browser dev tools. Recommend the same treatment as the array
   already removed.

2. **`support@ensight-technologies.com` hardcoded as the Web Push VAPID contact**
   (`api/send-push.js:200`). Ergon's own real domain, not a leak — but a singleton, non-
   configurable value. The VAPID contact is conventionally the entity operating the push
   infrastructure, so may be entirely appropriate to keep even in a multi-tenant future —
   flagging for awareness, not as a clear-cut defect. Already surfaced once before in the
   original tenancy audit; never part of tonight's fix list.

3. **`DEFAULT_BOM_SHIP_TO = "EnSight Office"` (`main.tsx:468`)**, used as the default ship-to
   value for BOM pull requests (6 call sites). The string is Ergon's own real brand name, fine to
   keep — but a hardcoded singleton default, not workspace-configurable. A second tenant's
   warehouse is not "EnSight Office." Same "ship-to address" item the original tenancy audit
   already flagged generically; here pinned to its exact source location.

4. **`STATIC_ALLOWED_HOSTS = ["ergon-ops-app.vercel.app", "localhost", "127.0.0.1"]`**
   (`api/_lib/validateUrl.js:11`) — the app's own real production domain, appropriate to keep for
   Ergon's single current deployment. A single-tenant assumption: a custom domain or renamed
   deployment would need this updated by hand; no env-var-driven mechanism. Not a security bug —
   correctly does its job today — just a scaling note.

5. **Real vertical-specific terminology is structurally embedded, not just cosmetically labeled**
   — worth documenting as its own category. `locationType: "garage" | "lot"` is a hardcoded,
   closed union baked directly into the type system and used pervasively; domain-specific camera
   fields (`fliCameraItemId`, `lprCameraItemId`, `peopleCountingCameraItemId`) and product-package
   definitions hardcode real dollar figures and real product-line items directly in source, live-
   used, not admin-configurable. Not a "hardcoded string to swap" — it's the actual data model of
   a parking/camera-occupancy-counting vertical product. A non-parking customer would find
   "garage/lot" nonsensical as their only location-type choice. A legitimate structural finding
   for future productization planning, consistent with how the tenancy audit already treats "the
   vertical-specific taxonomy" as a starter-template decision, not a quick patch.

### Checked and confirmed clean / appropriate to keep

- `"Ergon Ops"` fallback sender/company name (3 send-*.js routes + mailer.js) — Ergon's own real
  product name, used correctly only as a fallback. Appropriate to keep.
- No other hardcoded years found — every other year-derivation in `main.tsx` uses `new Date()`
  dynamically; no second instance of the fixed-year-rollover bug class exists.
- No leftover real personal names, street addresses, or client identifiers anywhere in `src/` or
  `api/` (only in migration seed data, explicitly out of scope per this session's limits).
- Legal/boilerplate proposal text is DB seed data, out of scope, and not duplicated anywhere in
  source code.

---

## Part D — Test coverage by business risk audit

### Full test inventory

| File | Framework | Runs in CI (`npm test`) | Cases |
|---|---|---|---|
| `tests/api/create-notification.test.js` | vitest | Yes | 26 |
| `tests/api/cron-task-overdue.test.js` | vitest | Yes | 7 |
| `tests/api/rateLimit.test.js` | vitest | Yes | 18 |
| `tests/api/sales-quote-extract.test.js` | vitest | Yes | 7 |
| `tests/api/send-invite-email.test.js` | vitest | Yes | 5 |
| `tests/api/send-notification-email.test.js` | vitest | Yes | 7 |
| `tests/api/send-notification-slack.test.js` | vitest | Yes | 5 |
| `tests/api/send-proposal-email.test.js` | vitest | Yes | 9 |
| `tests/api/send-push.test.js` | vitest | Yes | 11 |
| `tests/api/send-submittal-email.test.js` | vitest | Yes | 6 |
| `src/persistence.critical-loaders.test.ts` | vitest | Yes | 11 |
| `src/project-ref.test.ts` | vitest | Yes | 5 (tonight's new year-boundary tests) |
| `tests/smoke/auth-gate.spec.ts` | Playwright | Yes | 1 |
| `tests/smoke/navigation-and-shell.spec.ts` | Playwright | Yes | 5 |
| `backend/tests/inventory-automation.test.ts` | manual ts-node script | **No** — excluded from `vitest.config.ts`'s `include`; requires a real service-role key, documented as run-manually-only | N/A |

Vitest suite: 102/102 passing (per `HANDOFF.md`).

### Coverage by risk category

| Category | Assessment | Evidence |
|---|---|---|
| **Authentication** | Thin | No dedicated test for `requireAuth.js` itself; only exercised indirectly as a mocked precondition. One direct test is the Playwright auth-gate smoke test — a single happy/unhappy-path UI check, not route-level. |
| **Permissions/role checks** | Thin | `create-notification.test.js` covers role-based recipient resolution well (26 cases). No test exercises `requireRole.js` directly, or any RLS/write-gate. All RLS/permission verification for the recent tenancy work is manual SQL in Supabase Studio, not automated. |
| **Financial handoffs** | None | No test file references Client Ledger, Billing, or PO-total computation anywhere. These are UI-computed values with zero regression protection. |
| **Quote acceptance** | Thin, misleading if read as "covered" | `send-proposal-email.test.js` tests the notification *sent after* a response, mocked — does not exercise `respond_to_quote_proposal`'s actual SQL logic. The A3 reuse gap is untested and untestable by the current suite, since that RPC has no JS/TS wrapper test at all. |
| **Project conversion** | None | `createProjectFromClosedWonQuote` has zero test references. Flagged in `PRODUCT_PHASE2_PLAN.md` §2.3 as a real, currently-unowned data-copy path. |
| **Inventory movement** | None (automated) / thin (manual) | The one real test (`inventory-automation.test.ts`) is well-designed but excluded from CI. `persistence.critical-loaders.test.ts` covers only the read path. |
| **Deletion/restoration** | None | No test references `deletion_log`, `deleted_at`, or `deleted_by_email` — the entire soft-delete/restore mechanism across 15 tables has zero automated coverage. |
| **Scheduled jobs** | Adequate | `cron-task-overdue.test.js` (7 cases) is genuinely solid — missing-secret, wrong-secret, dedupe-on-409, role-only-assignee exclusion, non-409-failure logging. Best-tested risk category in the repo. |
| **Notifications** | Adequate for recipient-resolution | `create-notification.test.js` is the largest test file. Delivery itself is separately covered per-channel. |
| **Offline uploads** | None | No test references offline upload behavior, retry queues, or connectivity-loss handling. |
| **Tenancy (migration 115/117/118)** | Solid manual coverage, zero automated/CI coverage | `PRODUCT_PHASE2_PLAN.md` §11.1a's transaction-safe SQL test script (INSERT-stamping, all failure modes, UPDATE-immutability, cascade-delete) was written, run live, confirmed clean — real and thorough, but a manually-run SQL script, not a vitest file. A future migration regressing this behavior would not be caught by `npm test`. |

### Prioritized test-gap list (highest-value first)

1. **Automate the tenancy ownership tests (117/118) as real CI-runnable tests**, even against a
   disposable/staging Supabase project via service-role key (the same constraint
   `inventory-automation.test.ts` already works around). Highest-risk gap: a silent regression
   here (e.g., a future migration reintroducing the Revision-4 grant leak) would go undetected.
2. **Add a server-side status guard for `respond_to_quote_proposal` (and a regression test for
   it)** — directly relevant to A3: this RPC has no regression protection at all, and the reuse
   gap found here is exactly what a test would have caught before it shipped.
3. **Move `inventory-automation.test.ts` into the CI/vitest path**, or add an equivalent
   mocked-fetch unit test alongside it, so allocate-or-queue logic gets checked on every push.
4. **Add a focused test for `createProjectFromClosedWonQuote`** — real, currently-untested,
   architecturally significant.
5. **Add a minimal soft-delete/restore regression test** for at least one representative table
   (e.g. `sales_quotes`) — the pattern is uniform across 15 tables, so one good test catches a
   broad class of future regressions cheaply.

**Explicitly not recommended**: blanket test coverage for Client Ledger/Billing UI-computed
views, offline upload retry logic, or permission-check coverage beyond what's already exercised
through the notification-recipient tests — real gaps, but lower leverage relative to the five
above; adding them now would be coverage for its own sake rather than protecting genuinely
fragile, high-blast-radius behavior.
