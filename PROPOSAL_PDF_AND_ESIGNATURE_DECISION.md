# Frozen Proposal PDF and E-Signature — Trace and Design

Prepared 2026-09-15, in response to the instruction to trace and design both open threads
`PRODUCT_MASTER_COMPLETION_PLAN.md` §5 already anticipated separately: row 15 ("Real e-signature") and
row 16 ("Server-generated PDF"), and the decision-register's own D12 placeholder ("Keep typed
acceptance until the business confirms stronger legal requirements; evaluate PDF separately"). **Nothing
in this document has been implemented.** No migration, RPC, or frontend code exists yet for either
change described below. Both remain blocked on the decisions in §3; do not begin building either until
E has answered them. Billing and Phase 3 RLS are untouched and out of scope for this document.

## 1. Frozen Proposal PDF Generation/Download

### 1.1 Current state, traced directly against source

- `ProposalPublicPage` (`main.tsx:26733-`) already has a "Print / Save as PDF" button
  (`main.tsx:26958`, inside `<div className="proposal-print-actions">`). It calls plain `window.print()`
  — no PDF library, no server round-trip, no generated file. A comment left in the code at
  `main.tsx:26728` documents this as a deliberate scope cut: *"v1 has no generated PDF file; the 'Print
  / Save as PDF' button below just calls `window.print()` against a dedicated print stylesheet ... which
  is the agreed amount of scope for now."*
- **The content it prints is already frozen, correctly.** The entire render body
  (`main.tsx:26930-27117`) reads from `const snapshot = data.contentSnapshot;` — every section (BOM,
  SOW, pricing, template sections) comes from the same immutable `content_snapshot` jsonb that
  `approval_content_hash` is computed over (§2.1 below). So "frozen" is not a gap — what a client prints
  today is already exactly what they're being asked to approve, not live/mutable quote data.
- A dedicated `@media print` block exists (`styles.css:6532-6548`): hides the non-printable chrome
  (`.proposal-no-print`, `.proposal-print-actions`), strips layout padding, and adds
  `page-break-inside: avoid` on each section. This has already had real design attention, not just a
  bare browser default.
- `PRODUCT_MASTER_COMPLETION_PLAN.md:276` already named this exact question: *"Server-generated PDF — A
  real PDF export independent of the browser's print dialog... Whether this is worth a new dependency vs.
  keeping `window.print()` — Later — Business decision, Code."* This document is that evaluation.

### 1.2 What's actually missing

Not "frozen content" — that's solved. The real gap between today's browser-print button and a "real" PDF
feature is **no server-stored artifact**: nothing downloadable exists outside the client's own browser
session, nothing can be attached to an email, re-fetched later, or handed to another system (an ERP, a
compliance archive) as a standalone file. Today's button serves one person, once, from their own
browser's print dialog — it produces nothing the business itself holds onto.

### 1.3 Recommended design

**Recommended default: do not build server-side PDF generation now.** Keep `window.print()` exactly as
it is — it already reads the correct frozen content, it costs nothing further, and every modern browser's
print dialog already offers "Save as PDF," so the *client's* own-copy need is already met. Building a
server-side rendering pipeline (see options below) is real, ongoing engineering surface — new dependency,
new failure mode, new thing to keep visually in sync with `styles.css`'s print rules — and should not be
taken on speculatively.

**Add a real PDF pipeline only if the business confirms a concrete need the browser button can't meet** —
specifically: (a) wanting a canonical stored file the business itself can retrieve later without asking
the client to re-print, (b) wanting to email a PDF attachment (e.g. a copy of the accepted proposal) as
part of an approval-completion workflow, or (c) an external system (ERP, compliance archive) needing a
real file, not a link. If any of those is a real requirement, here are the practical options, in order of
fit for this app's Vercel serverless deployment:

| Approach | Fit here | Tradeoff |
|---|---|---|
| **`@react-pdf/renderer`** (recommended if needed) | Pure JS, no headless browser, runs cleanly in a Vercel serverless function, deterministic output | Requires a second, simpler layout definition for the PDF — can't directly reuse the HTML/CSS, so the BOM table/pricing/SOW get built twice (once for the web page, once for the PDF document tree) |
| **`puppeteer-core` + `@sparticuz/chromium`** | Renders the *exact* same HTML/CSS already built for print, pixel-identical to `window.print()` output | Heavier: larger function bundle, slower cold starts, more moving parts to keep working on Vercel's serverless limits |
| **Third-party rendering API** (e.g. a hosted HTML-to-PDF service) | Least engineering effort | New paid vendor dependency, and proposal content (client name, pricing) would leave the app's own infrastructure |

If this gets approved, `@react-pdf/renderer` is the practical default — it fits the serverless deployment
without a headless-browser dependency, at the cost of a small amount of duplicated layout work.

### 1.4 What this does NOT do

No change to today's print button or its output — it stays as the free, already-correct "client saves
their own copy" path regardless of what's decided here. No email-attachment automation, no ERP/compliance
export, unless those are the confirmed reason to build the pipeline at all (§3, D18).

## 2. E-Signature Scope, Legal Record, Signer Identity, Completion Behavior

### 2.1 Current state, traced directly against source

- The response/approval RPC (originally `053_sales_quote_proposals.sql:169-205`, most recently
  redefined by migration 148 to add the D17 optional-BOM parameter) computes:
  ```sql
  approval_content_hash = encode(sha256(snapshot::text::bytea), 'hex')
  ```
  where `snapshot` is `sales_quote_proposals.content_snapshot` (jsonb) — the same immutable snapshot
  §1.1 confirmed the print button renders. This is already a correct, tamper-evident binding between
  "what was hashed" and "what the client actually saw."
- Current columns on `sales_quote_proposals` relevant to approval: `client_name`, `client_email`,
  `approval_name` (free text), `approval_ip` (text), `approval_content_hash` (text), `responded_at`,
  `response_notes`. **No `approval_email` column exists.**
- The frontend (`persistence.ts:12913-12944`, `respondToPublicQuoteProposal`) sends:
  ```ts
  approver_name: approverName || "Unknown",
  approver_ip: "",   // always sent as a literal empty string
  ```
  **`approval_ip` is dead code today** — the client never captures a real IP, and nothing server-side
  fills it in either (no `inet_client_addr()` fallback in the RPC). The column exists and is stored on
  every row, but it has never held a real value. This is worth fixing regardless of the bigger
  e-signature decision below: a schema field that looks like part of an audit trail but silently isn't
  is a worse state than not having the field — this repo has already been burned once by an assumption
  that didn't match live reality (the `notification_rules.event_type` incident, migration 054).
- UI (`main.tsx:27104-27114`): the only inputs collected before Approve/Reject/Request Revision are a
  free-text **"Your name"** field (no validation beyond non-empty) and optional notes. No email capture,
  no login, no click-through verification of any kind — possession of the share-link token is the entire
  access control, matching how every other client-facing surface in this app already works (no client
  accounts exist anywhere in the product).
- `PRODUCT_MASTER_COMPLETION_PLAN.md:275` already frames the ceiling case explicitly: *"Real
  e-signature — Drawn/certificate-based signature or a third-party integration (e.g. DocuSign-equivalent
  legal weight)... Nothing [is a small extension] — this is a materially different trust/liability
  surface... should not be started without an explicit decision on the legal-weight question."*

### 2.2 Recommended design, by sub-question

**Scope** — Recommend staying with typed-acceptance (name + content-hash), not a drawn signature and not
a third-party e-signature platform (DocuSign-equivalent). A full e-signature integration is a genuinely
different liability surface — identity verification, a tamper-evident certificate, replay protection —
and nothing traced above suggests this app currently needs that level of legal weight for a B2B sales
proposal. Recommend building it only if the business identifies a specific deal type or jurisdiction that
requires it; it is not a good default to build speculatively.

**Legal record** — Recommend this concrete composition, most of which already exists correctly:
`approval_name` (typed, as today), a new `approval_email` column (see Signer identity below),
`approval_ip` **fixed to actually capture the real value** (read from the request's forwarded-for header
in the serverless function handling the response — a small, concrete fix, not a scope question),
`approval_content_hash` (existing, already correct), `responded_at` (existing), and the permanently
retained `content_snapshot` itself as the definitive record of what was agreed to. That combination —
typed name, a real email, a real IP, a content hash, a timestamp, and the immutable snapshot — is a
reasonable, defensible "clickwrap"-style legal record for this kind of B2B sales approval, without taking
on a full e-signature platform.

**Signer identity** — Recommend a small, concrete addition rather than a verification flow: capture and
store `approval_email` alongside `approval_name` at response time. `client_email` already exists on
`sales_quote_proposals` from when the proposal was sent — pre-fill it read-only (or require it be
re-typed to match) rather than accepting an arbitrary name with zero corroboration, which is what happens
today. This does **not** add real cryptographic identity verification (no magic-link click-through, no
OTP/email-code step) — token possession remains the actual access control, matching every other
client-facing flow in this app. Flag whether a stronger step (an OTP sent to `client_email` before the
response is accepted) is worth the added friction as an open question — recommend deferring it unless
the business has a specific reason to need it, since it changes the flow from one click to two and this
app has no other precedent for that pattern.

**Completion behavior** — Recommend no new side effects beyond what already happens today (the status
transition and whatever existing notification fires on `quote_proposal_responded`). Do not tie PDF
generation (§1) to the approval event by default — keep the two decisions in this document independently
answerable. **If, and only if,** §1's server-PDF pipeline is approved, the approval-completion moment is
the one natural place to trigger it (generate once, at the moment the content becomes legally final,
rather than on every print/view) — noted here as an interaction point, not a default to build now.

### 2.3 What this does NOT do

No drawn-signature capture, no third-party e-signature integration, no OTP/magic-link verification step
by default, no change to the three existing terminal responses (approve/reject/revision_requested) or
their authorization. No dependency on §1's PDF decision unless §1 is separately approved.

## 3. Decisions needed — present together, recommended default in parens

Updates the standing decision register (`CONTINUOUS_CODER_HANDOFF.md` §8): revises D12's language now
that this trace exists, and adds a new D18 for the PDF-specific question (no renumbering — D12 already
anticipated splitting these two topics apart, and this keeps that same split).

| ID | Decision | Recommended default | Blocks |
|---|---|---|---|
| D12 (revised) | E-signature scope, legal record, signer identity | Keep typed-acceptance (no drawn signature, no third-party integration); fix the currently-dead `approval_ip` capture; add a new `approval_email` column, pre-filled/verified against the proposal's existing `client_email` rather than accepting an uncorroborated name; no OTP/click-through verification step by default | Any e-signature-hardening work |
| D18 (new) | Frozen proposal PDF: build a server-generated pipeline, or keep `window.print()` | Keep `window.print()` as the default; only build a server pipeline (`@react-pdf/renderer` recommended) if the business confirms a concrete need — a stored canonical file, an email-attachment step, or an external system needing a real file — that the browser's own "Save as PDF" can't meet | Any PDF-generation implementation |

Neither decision, once made, requires touching Billing or Phase 3 RLS. The `approval_ip` fix (part of
D12) is a small, low-risk correction independent of the larger scope question and could be taken on
regardless of which direction D12 goes overall — flagged here, not assumed approved.

## 4. Suggested sequencing once decided

Independent of each other. If only one can be picked up immediately: the `approval_ip` fix and
`approval_email` addition (D12) are the smaller, more clearly-scoped change (two column additions, one
serverless-side fix, one UI field) with an immediate, concrete correctness benefit (closing a currently
fake audit field) regardless of whether the business ever wants the heavier PDF pipeline. D18, if
approved at all, is naturally sequenced after D12 if the completion-behavior trigger (§2.2) is wanted,
since it reads the same approval-completion moment.
