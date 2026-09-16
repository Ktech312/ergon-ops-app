# Client Proposal Q&A and Optional BOM Lines — Trace and Design

Prepared 2026-09-15, in response to the instruction to trace and design both §5 row 13 (Client Q&A)
and row 14 (Optional/alternate BOM line items) from `PRODUCT_MASTER_COMPLETION_PLAN.md`, and present
every open business decision together with a recommended default. **Nothing in this document has been
implemented.** No migration, RPC, or frontend code exists yet for either feature. Both batches remain
blocked on the decisions in §3 below; do not begin building either until E has answered them.

This document supersedes the two rows' brief entries in `PRODUCT_MASTER_COMPLETION_PLAN.md` §5 and
`PRODUCT_SALES_EXPERIENCE_PLAN.md`'s "Client comments/questions on a proposal" section — both of
those were written from a lighter pass (the latter explicitly says its channels citation was "not
re-traced line-by-line in this pass"). This is that re-trace, done directly against the live schema
and source, and it changes the recommended mechanism for Q&A (§1.3) as a result.

## 1. Client Proposal Q&A

### 1.1 Current state, traced directly against source

- `ProposalPublicPage` (`main.tsx:26571-`) is the entire client-facing surface for a proposal. It is
  unauthenticated (reached via `?proposal=<token>`, no login) and today offers exactly one interaction:
  a single terminal response — Approve, Reject, or Request Revision — each submitted once via
  `respond_to_public_quote_proposal(token, decision, approver_name, notes)`
  (`backend/supabase/migrations/119_secure_quote_proposal_response.sql`, re-applied unchanged by 137/139/143/145).
  `notes` is a free-text field bundled with that one decision — there is no way to leave a comment or
  ask a question without simultaneously locking in a final status. "Request Revision" is the closest
  fit today, but it still forces a status change and ends the interactive flow ("a revision has been
  requested... your Ergon representative will follow up") rather than opening a two-way exchange.
- The earlier plan's suggested mechanism — post into the existing `channels`/`channel_messages` system
  (migration 101) — does not fit on closer inspection, for three concrete reasons:
  1. **`channel_messages` INSERT is gated `to authenticated with check (sender_id = auth.uid())`**
     (migration 101, line 68-69). There is no path for an anonymous, token-holding client to write into
     it without a new SECURITY DEFINER RPC anyway — at which point reusing `channels` buys nothing over
     a dedicated table, since the RPC is the real access-control layer either way.
  2. **`client`-type channels were never actually built.** Migration 101's own header says "Client
     channels are phase 4, once clients exist as a real entity; not here," and a `clients` table does
     exist now (migration 102) — but grep confirms `'client'` only ever appears in the `channels_type_check`
     CHECK constraint (migration 105); no `client_id` column, no auto-create trigger, and no UI ever
     shipped for it. Building proposal Q&A on top of this would mean building the client-channel phase
     first, as an undocumented prerequisite for what was scoped as a smaller feature.
  3. **`channels` has no per-quote or per-proposal scoping dimension** — only `section_key` or
     `project_id`. A client's question is about one specific quote (sometimes one specific *version* of
     it); a client-wide channel would mix that in with every other project/conversation involving that
     client, which is a materially bigger, differently-shaped feature (a general client-relationship feed)
     than "let me ask a clarifying question about this proposal before I decide."
- `sales_quote_proposal_approval_requests` (migration 147, shipped today) is the closest existing
  precedent for "an unauthenticated-adjacent write needs to reach an internal review surface" — except
  that one is written by an *authenticated* Sales rep, not the anonymous client. The token-authorized
  anonymous-write pattern this needs instead already exists too, just on a different table:
  `get_quote_proposal_by_token`/`respond_to_public_quote_proposal` (migration 145/119) — anon-granted,
  security-definer, validates the token's live status (found/expired/superseded/unavailable) before
  doing anything, exactly the shape a new "submit a question" RPC should copy.

### 1.2 Recommended design (implementation-ready once decided)

- **New table `sales_quote_proposal_questions`**, one row per question: `id`, `quote_id` (not
  `proposal_id` — see below), `question_text`, `asked_at`, `asker_name` (optional, client-supplied),
  `status` (`'open' | 'answered'`), `answer_text`, `answered_by`, `answered_by_email`, `answered_at`.
  RLS: read policy for `authenticated` (any internal user working the quote, matching the existing
  `sales_quote_proposals` read posture) — **zero write policies**, every write goes through the two
  RPCs below, applying this repo's own "close direct-write bypasses" discipline from day one (Queue
  C2.7's lesson, already applied proactively in migration 147). Explicit `revoke all ... grant select`
  grant-layer correction from the start (migration 141's lesson).
- **Scoped to `quote_id`, not `proposal_id`.** A client is having one conversation about one deal, not
  a separate conversation per frozen version — if Sales sends v2 after a revision request, a question
  asked against v1 should still show up for the rep working that quote. (If E prefers strict
  per-version scoping instead, that's a one-column change, not a different design — flagged as D16's
  first sub-question.)
- **Two new RPCs, mirroring the established pattern exactly:**
  - `submit_proposal_question(share_token text, question_text text, asker_name text)` — `security
    definer`, `set search_path = ''`, granted to `anon` only (matches `get_quote_proposal_by_token`'s
    grant exactly). Validates the token resolves to a live, non-expired/superseded/revoked proposal
    (same status check as `get_quote_proposal_by_token`) before inserting — a dead link cannot be used
    to spam a question in. Length-caps `question_text` (recommend the same 4000-char ceiling
    `channel_messages` already uses, for consistency, not a new number to justify) and rejects empty
    text.
  - `respond_to_proposal_question(question_id uuid, answer_text text)` — `security definer`, granted to
    `authenticated` only, authorized via `has_role('sales') or has_role('manager') or is_app_admin()`
    (matching `create_and_send_quote_proposal_version()`'s own existing authorization for this exact
    call chain — same reasoning migration 147 used: match the function/table this one is adjacent to,
    not the newer `workspace_member_roles` pattern). **Recommend NOT requiring the answering user to be
    the specific quote's assigned Sales rep** — any Sales/manager/admin can answer, since a question
    should get answered by whoever is available, not blocked on one person being online. (D16's second
    sub-question, if E wants it restricted instead.)
- **UI placement: inside `SalesQuoteBuilder`'s existing Quote Proposal panel**, not a new Admin-page
  review queue. This is a deliberate difference from Batch 5's approval-request panel: answering a
  client's question is routine deal-work the assigned rep does in the course of working their own
  quote, not a controlled gate a manager approves — it belongs next to the proposal list a rep is
  already looking at, the same place the new "awaiting Sales Manager approval" note from Batch 5 now
  lives. On the client side, a new "Ask a question" button on `ProposalPublicPage`, visible only while
  `phase === "ready"` (before a terminal response) and also after a `revision_requested` response (so a
  client can still clarify what needs to change) — not after approve/reject, which are final.
- **Notifications deliberately deferred**, same reasoning as migration 147: this repo has a documented
  real production failure from reconstructing `notification_rules.event_type`'s CHECK-constraint
  allow-list from migration files instead of live data. A new question is fully visible without a push
  notification — it shows in the Quote Proposal panel the next time a rep opens the quote — so this is
  a safe, explicit scope cut, not a silent gap, left as a small independent follow-up once the live
  event_type list can be confirmed.
- **Implementation note, not a business decision:** `sales_quote_proposals.approval_content_hash`
  exists to give the typed-acceptance flow (D12's current, not-yet-upgraded trust mechanism) something
  to hash. If optional-BOM selection (§2) ships before Q&A does, and a question thread is later added
  to what gets hashed at approval time, whoever builds that should confirm the hash still covers
  everything meant to be "agreed to" — noted here so it isn't missed later, not something E needs to
  decide now.

### 1.3 What this design deliberately does NOT do

No e-signature/legal-weight change (untouched, per the standing instruction). No change to
`respond_to_public_quote_proposal`'s own approve/reject/revision flow — asking a question never
changes `sales_quote_proposals.status`. No real-time/websocket delivery — a rep sees a new question the
next time they load the quote, matching this app's existing polling-on-load pattern everywhere else.

## 2. Optional / Alternate BOM Line Items

### 2.1 Current state, traced directly against source

- `SalesQuoteBomLine` (`persistence.ts:9513-9548`) has no `isOptional`/`is_optional` field today —
  confirmed by reading the full type definition, not by a grep alone. `ProposalBomLineSnapshot`
  (`persistence.ts:11936-`) likewise has none.
- `computeProposalTotals(lines, discountPercent, taxRate)` (`persistence.ts:12177-12189`) is the single
  source of every total shown anywhere (`buildProposalSnapshot` at send time, and — per Batch 1/2 —
  the frozen values `ProposalPublicPage` renders). It sums every line unconditionally; there is no
  concept of exclusion today.
- The earlier plan's stated blocker — "sequenced behind Batch 1, meaningless without a visible price to
  accept/decline" — **is now cleared.** Batch 1 (frozen per-line pricing) shipped and is
  production-verified (Queue C1, migration 136). This batch has no remaining sequencing blocker, only
  the product-behavior decisions below.
- `sales_quote_bom_lines` is written through direct PostgREST calls (`updateSalesQuoteBomLine`,
  `persistence.ts:10186-`), not an RPC — a plain trigger-guarded PATCH. Adding one more boolean column
  to that same payload is a small, low-risk extension of an already-simple write path; it needs no new
  RPC for the **Sales-side** edit.

### 2.2 Recommended design

- **`sales_quote_bom_lines.is_optional boolean not null default false`.** Sales flags a line optional
  while building the quote — a checkbox next to the existing item/qty/notes fields in the BOM line
  editor, written through the existing `updateSalesQuoteBomLine`/add-line path (one more field in an
  existing payload, no new RPC, no new grant surface).
- **`ProposalBomLineSnapshot` gains `isOptional: boolean`**, frozen at send time exactly like every
  other field in that snapshot — an already-sent version's optionality never silently changes if the
  live quote is edited later, same invariant `unitPrice`/`imageUrl`/etc. already follow.
- **Live client-side recomputation needs no new persisted state or write path.** The frozen snapshot
  already contains every optional line's `unitPrice`/`qty`/`lineTotal`; `ProposalPublicPage` can
  maintain a local `Set` of excluded line indices and recompute the displayed subtotal/discount/tax/
  total in the browser using the exact same math `computeProposalTotals` already does (import/reuse
  that function, don't duplicate the rounding logic) — purely a rendering concern, not a new backend
  surface, matching this codebase's preference for the smallest change that does the job.
- **The client's final selection is captured at response time, not on every toggle.** Extend
  `respond_to_public_quote_proposal`'s existing payload with one new parameter,
  `p_excluded_optional_lines integer[]` (line indices into `content_snapshot.bom`, the frozen array
  already sent) — recorded into a new `sales_quote_proposals.selected_optional_lines jsonb` column
  (`null` for a version with no optional lines, or one predating this feature — same "absent means N/A"
  pattern `subtotal`/`discountPercent`/etc. already use). This reuses the one write path the public
  page already has instead of inventing a second, continuously-saving one — no new RPC, no new anon
  grant, and it keeps `content_snapshot` itself permanently frozen, which every other piece of this
  system already depends on.
- **Selection is captured regardless of which of the three terminal actions the client takes** —
  approve, reject, or request-revision — since a client requesting a revision may still want to record
  "please drop item X," not only a client who approves.

### 2.3 Interaction with what already shipped today

No interaction with the D4 discount-approval gate (Batch 5, shipped today) — that gate reads
`sales_quotes.discount_percent`, set by Sales, unrelated to which optional lines a client later
excludes on their copy. Worth a one-line note for whoever implements this, not a decision: don't
conflate "the client removed an optional add-on" with "the deal's discount changed."

## 3. Decisions needed — present together, recommended default in parens

Added to the standing decision register (`CONTINUOUS_CODER_HANDOFF.md` §8) as D16/D17. Format matches
every prior entry there (D1-D15): decision, recommended working direction, what it blocks.

| ID | Decision | Recommended default | Blocks |
|---|---|---|---|
| D16 | Client Proposal Q&A: mechanism, scope, and who may answer | Dedicated `sales_quote_proposal_questions` table + two token/role-gated RPCs (NOT the `channels` system — see §1.1 for why that doesn't fit); scoped to the quote, not one frozen proposal version; any Sales/manager/admin may answer, not only the assigned rep; notifications deferred as a documented follow-up | Client Proposal Q&A implementation |
| D17 | Optional/alternate BOM lines: default inclusion state and whether selection blocks/gates the response | `is_optional` boolean on `sales_quote_bom_lines`; optional lines **default to included** (checked) on the public page — the client consciously removes an add-on rather than opting into one, matching how most quoted add-ons are meant to read; excluding an optional line never blocks or requires extra approval to submit any of the three terminal responses | Optional BOM line implementation |

Both are additive, non-breaking schema changes with no effect on any already-sent proposal (both new
columns default to values that reproduce today's exact behavior for every existing row). Neither
touches e-signature, Billing, or Phase 3 RLS.

## 4. Suggested sequencing once decided

Independent of each other — either can be built first. D17 (optional BOM lines) is the smaller change
(one boolean column, one client-side computation, one RPC-parameter extension) and has no UI surface
beyond what already exists (the BOM line editor, the public proposal page); D16 (Q&A) is a full new
table + two new RPCs + a genuinely new UI element (the "Ask a question" flow) and is proportionally
more work. Recommend D17 first if only one can be picked up immediately.
