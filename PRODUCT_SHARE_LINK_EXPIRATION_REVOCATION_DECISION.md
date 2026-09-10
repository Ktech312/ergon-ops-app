> **✅ RESOLVED (13.1)**: `is_app_admin(uuid)` and six workspace helper functions had a live `anon` EXECUTE grant left over from migration 124's incomplete grant block. Confirmed live, fixed by migration 125, re-confirmed closed — all run by E directly. See 13.1 for the full record.
>
> **✅ RESOLVED (13.3)**: `bridge_drift_report()`'s ambiguous-column bug, fixed by migration 126.
>
> **✅ GATE 1 PRECONDITION MET (13.5)**: the corrected `migration_124_bridge_tests.sql` (revision 4 — no destructive workspace DELETE, structural zero-workspace verification) ran clean end to end: "Success. No rows returned," no exception raised anywhere. Given the script's own design — both a test failure and a skipped section always raise a hard exception — a clean run with no error can only mean every section passed and zero sections were skipped. **This is the first time the full bridge-test suite has ever completed successfully.** See 13.5. Gate 1's remaining steps (commit/push, Vercel deploy, live verification) have NOT been taken — awaiting E's explicit go-ahead, since the scope has grown since Gate 1 was first defined (migrations 125 and 126 now need to be included in whatever gets committed, which wasn't part of the original instruction).

# Share-Link Expiration & Revocation — Decision Document

Status: **read-only research and decision document. No code, schema, or production behavior has been changed.** Everything below is either a directly-verified fact about the current system (with file:line citations) or a proposal awaiting your decision.

Scope: proposal share links (`sales_quote_proposals`) and submittal share links (`project_submittals`) only. Both reuse a shared `public_share_tokens` table, so most findings and options apply identically to both, and are written once with differences called out where they exist. **Phase 3 RLS and multi-workspace are explicitly out of scope** — one finding below (internal read exposure) is adjacent to that work and is flagged, not addressed, here.

---

## Part 1 — How this actually works today

### 1.1 Token generation

Both proposal and submittal links use the same generator, `generateShareToken()` (`src/persistence.ts:3711`):

```ts
function generateShareToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
```

Two concatenated UUIDs (256 bits of real entropy) in the normal browser path — not guessable. The `Math.random()` fallback only fires if `crypto.randomUUID` is unavailable, which no supported browser hits in practice.

The token is inserted as a brand-new row into `public_share_tokens` (`token` is the primary key) by `createSubmittalShareToken()` (`persistence.ts:3805`) and `createQuoteProposalShareToken()` (`persistence.ts:10592`) — both are simple one-shot `INSERT`s, nothing reused.

### 1.2 Are tokens reused when a document is resent? — **No. Confirmed by direct trace.**

There is no separate "resend" action. The only action is **"Create & Send Submittal"** / **"Create & Send Proposal"** (`main.tsx:4752` `handleCreateSubmittal`, `main.tsx:4854` `handleCreateQuoteProposal`), and it is used identically for the very first send and every subsequent one. Every click:

1. Loads every existing version of the document.
2. Computes `nextVersion = max(existing versions) + 1`.
3. Inserts a **brand-new row** (new `id`, new `version`, `status: "sent"`) — the old row is never touched.
4. Generates and inserts a **brand-new share token** pointing at the new row.

The old row, and its old token, are left exactly as they were. **This is the central fact this whole document is about**: right now, sending v2 does not expire, disable, or in any way affect v1's link. If the client still has the v1 email, that link still resolves and is still fully respondable.

Concretely: `respond_to_submittal()`/`respond_to_quote_proposal()` (migrations 122/121) only guard `where id = target_id and status = 'sent'` — they check whether *that specific row* is still open, not whether it's the *latest* row. So today, if a PM sends v1, then sends a corrected v2, a client who never saw v2 could still click Approve on the stale v1 link and it would succeed — the row exists, its status is still `sent`, and nothing in the RPC knows a v2 exists. The internal team would see "v1: approved" and "v2: sent" sitting side by side with no indication anything is wrong.

### 1.3 What `expires_at` currently does — **Nothing. Confirmed: no code path ever sets it.**

`public_share_tokens.expires_at` (`025_phase11_scheduling_templates_submittals.sql:99`) is a nullable `timestamptz` with no default. Every RPC that validates a token checks it defensively:

```sql
and (t.expires_at is null or t.expires_at > now())
```

— present in migrations 025, 053, 054, 055, 119, 121, 122. The *check* is real and would work correctly the instant something started writing a real value. But grepping every migration and the entire `persistence.ts`/`main.tsx` for any `INSERT`/`UPDATE` that sets `expires_at` on `public_share_tokens` returns **zero results**. The column exists, the enforcement exists, but nothing has ever populated it — every link created since Submittals shipped is permanently open, by omission rather than by design.

### 1.4 Every UI and RPC that reads or validates these tokens

**RPCs (both `security definer`, callable by `anon`, no login required):**
- `get_submittal_by_token(text)` / `get_quote_proposal_by_token(text)` — read-only lookup, used to render the public page. Current versions: migration 122 (submittal), migration 121 (proposal).
- `respond_to_submittal(...)` / `respond_to_quote_proposal(...)` — the write path, atomic `status='sent'`-gated update, current versions: migration 122/123 (submittal), migration 119/121 (proposal).

**Public UI:** `SubmittalPublicPage` (`main.tsx:24552`), `ProposalPublicPage` (`main.tsx:24739`) — reached via `?submittal=<token>` / `?proposal=<token>` query params on the app's root URL (`main.tsx:25103-25119`), not a distinct route.

**Internal UI:** the per-project Submittals modal (`main.tsx:12603-12672`) and the per-quote proposal list inside the quote detail view (`main.tsx:22829-22865`). Both are scoped — a user has to open a *specific* project or quote to see its documents. **There is no company-wide "all share links" screen.**

**Direct database access (not through the app UI at all):** `public_share_tokens` RLS is `"authenticated manage public_share_tokens" for all to authenticated using (true) with check (true)` (`025:105-106`) — `for all` means select, insert, update, *and* delete, not scoped to PM/admin or to a document's owner. **Any signed-in user of any role can read, and even directly modify or delete, every live token, and can read every submittal/proposal row (`"authenticated read project_submittals"`/`"authenticated read sales_quote_proposals"`, both `using (true)`), directly via the Supabase REST API**, whether or not the app's own UI ever shows them that screen. This is a real, currently-live fact, not a hypothetical — flagged here because it's directly relevant to "who can see a link" (and, notably, means a "Disable link" feature could technically already be hand-rolled today by any employee via a raw REST call, with no audit trail — see section 1.7), but the actual fix (role-scoped RLS) is Phase-3-RLS territory and out of scope for this document.

One more version-integrity detail worth having on record: `version` numbers are computed client-side (`Math.max(existing versions) + 1`, not server-assigned), and no migration adds a unique constraint on `(quote_id, version)`/`(project_id, version)` — two people clicking "Create & Send" for the same quote/project within the same round-trip could theoretically create two rows both claiming the same version number. Unrelated to expiration/revocation directly, but adjacent enough (it's the same "which version is real" question section 1.2 raises) to flag while it's already surfaced.

### 1.5 What happens on revise, replace, archive, convert-to-project, or completion

- **Revise/replace**: covered above — there is no distinct "revise" action. "Create & Send" is the only path, and it always creates a new version + new token, leaving every prior version's row and token untouched, forever.
- **Archive**: neither `sales_quote_proposals` nor `project_submittals` has any archive flag, and neither participates in the site-wide soft-delete standard (`deleted_by_email`/`deleted_at` + `deletion_log`, HANDOFF.md's "Any new delete action... must soft-delete" rule) — grepped directly, zero matches. **No `deleteQuoteProposal`/`deleteSubmittal` function exists anywhere in the codebase** — an individual proposal/submittal row (and its token) can never be removed from the app at all, only superseded by creating a new version. There is no way to archive or remove a document or its link short of a raw database operation.
  - **A sharper, concrete version of this gap**: the *quote itself* can be "deleted" (`deleteSalesQuote`, `persistence.ts:8743-8761`) — but that's a soft-delete, a `PATCH` setting `deleted_by_email`/`deleted_at`, never a real `DELETE`. `sales_quote_proposals.quote_id` has an `on delete cascade` foreign key (migration 053), but that only fires on an actual row deletion — a soft-delete never triggers it. **Practical consequence**: a PM "deletes" a quote from the internal UI (it disappears from their own quote list), while every proposal ever sent for that quote — and every one of their public share links, full content included — stays exactly as live and publicly viewable as before. The internal team would reasonably assume "deleted" means "gone"; a client (or anyone with the old link) would see no difference at all.
- **Convert to project**: a Sales Quote moving to `status = 'closed_won'` (`048_sales_quote_status_and_bom.sql:10`) optionally triggers `onCreateProjectFromClosedWonQuote` (`main.tsx:22313-22323`, behind a `window.confirm`), which copies contact info, BOM, and site/photo data into a new `projects` row (`projects.source_sales_quote_id`/`converted_from_quote_at`, migration 064). **This conversion has no relationship to `public_share_tokens` at all** — it neither reads nor writes any proposal token, and does not touch `sales_quote_proposals` rows. A proposal's link stays exactly as live after its quote becomes a project as it was before.
- **Completion (approved/rejected/revision_requested)**: no further automatic action of any kind. The row's `status` changes, `respond_to_submittal`/`respond_to_quote_proposal` fires the (now-fixed) notification, and that's the entire effect. Nothing marks the link inert, nothing schedules a future expiration, nothing archives the row.

### 1.6 Can internal users see, copy, disable, or regenerate links today?

- **See/copy**: yes, via the **"Copy client link"** button (`main.tsx:12651-12665` submittals, `main.tsx:22848-22862` proposals) next to each version's row inside its project/quote's own modal. This copies the currently-generated URL to the clipboard; the raw token/URL is never displayed as visible text on screen, only copied.
- **Disable**: **does not exist.** No button, no handler, no RPC.
- **Regenerate**: **does not exist** as a distinct action — the closest equivalent is sending a new version, which (per 1.2) does not disable the old link.

**Existing precedent worth knowing about**: the app already has a working "disable a link" pattern for a *different* feature — user invites. `revokeInvite()` (`persistence.ts:854-874`) does a simple `PATCH user_invites SET status='revoked'`, checks the affected-row count so a silently-blocked permission failure can't be reported as success, and the public invite-landing page has its own dedicated "Invite revoked" state (`main.tsx:25032-25036`) with a UI button (`main.tsx:17329`, `onRevokeInvite`). This is a real, already-shipped, already-tested shape for exactly the kind of "Disable link" action under discussion — not a proposal to reuse it, just a fact worth having on the table since it de-risks that option if chosen.

### 1.7 Is link access logged?

**No, on both meanings of "access."** Grepped the entire repo for any page-view/access-log table or event (`page_view`, `link_access`, `access_log`, `token_access`, `viewed_at`, `last_viewed` — the only hits were unrelated columns like catalog-price-change `reviewed_at`). Two distinct gaps exist:

- **Viewing** a public link (loading the page, before any response) is never recorded anywhere. The only trace an internal user gets that a link was opened is if the client actually clicks Approve/Reject/Request Revision.
- **Creating** a link is also unattributed — `public_share_tokens` has no `created_by_user_id`/`created_by_email` column, so even the audit trail of "who generated this link and when" (beyond a bare `created_at` timestamp) doesn't exist today.

There is also, of course, no log of admin actions like disable/regenerate, because those actions don't exist yet.

### 1.8 What customer/project information remains visible through a link after completion

**All of it, unconditionally, forever.** This is the most consequential finding. Both public pages render the full original document content completely outside any `phase === "ready"` gate — only the *response form* (the Approve/Reject/Request Revision buttons) is conditionally shown; the content itself is not:

- `SubmittalPublicPage` (`main.tsx:24690-24712`): full Scope of Work (summary, preparation, infrastructure, installation, commissioning, fine-tuning, assumptions, exclusions) and the full Bill of Material (item + qty) render unconditionally, regardless of `status`.
- `ProposalPublicPage` (`main.tsx:24884-24919`): the executive summary, the full BOM table (with product images, descriptions, manufacturer names, and datasheet links), and every legal/boilerplate template section (Payment Terms, Warranty, SSSA Term Details, etc.) all render unconditionally, regardless of `status`.

Concretely: a submittal approved eight months ago is, today, exactly as viewable via its original link as it was the day it was sent — same scope, same BOM, same everything — with no time limit and no way to turn it off. (One side note, not a security issue but worth knowing: the proposal page's BOM section is literally labeled "Pricing & Bill of Material," but the underlying `content_snapshot` line-item shape — `item`, `qty`, `notes`, `imageUrl`, `description`, `manufacturer`, `hasDatasheet`, `datasheetUrl` — never actually carries a dollar figure, so no real price data is exposed through this page today regardless of the header text. Flagged only because it's directly adjacent to "what customer information is visible," not something this document is asking you to fix.)

Neither email (`api/send-submittal-email.js:95-99`, `api/send-proposal-email.js:104-109`) mentions any expiration window or link-safety messaging to the client today — both are a one-line "click here to review" with no caveat.

---

## Part 2 — The three decisions, compared

### 2.1 Link expiration

| Option | What it means in practice | Real-world example | Tradeoff |
|---|---|---|---|
| **Never expires** (today's actual behavior) | A link sent in January still works in December. | A client's procurement contact leaves the company in March; their old work email (still receiving forwards, or simply still logged into a shared inbox) can approve a submittal in November that no one currently at the client company has reviewed. | Zero friction for legitimate slow-moving approvals (large clients, committee sign-off); maximum exposure window for a stale or leaked link. |
| **Expires on the quote/submittal due date** | Reuses a date the document already has (`project.due` / a quote's own due-date field) as the link's `expires_at`, automatically, no extra step for the sender. | A submittal with a March 15 target install date auto-expires its link March 15, whether or not the client has responded. | Zero extra sender effort, but couples two unrelated concepts — a *project* due date and a *link validity* window aren't the same thing, and a document sent late (due date already passed, or very close) could expire before the client even opens it. |
| **Employee selects an expiration date when sending** | A date picker appears in the "Create & Send" flow (`main.tsx:4752`/`4854`); the sender picks a real window (e.g., "expires in 14 days") each time. | A PM sending a submittal to a client known to be slow knowingly picks 45 days instead of the default 14. | Maximum flexibility per-document; also maximum chance of a rushed sender picking nothing, picking something too short, or forgetting entirely — needs a sensible default pre-filled, not a blank field. |
| **Company-configurable default with an employee override** | An admin sets one company-wide default (e.g., "links expire after 30 days") in a settings screen; the send flow pre-fills that default but lets the sender change it per document. | Ergon sets a 30-day company default; a PM sending to an unusually slow client bumps that one submittal to 60 days without changing anyone else's default. | Combines consistency (nobody has to think about it on the common case) with flexibility (the rare case isn't blocked) — the option your stated preference already favors, and it's the only one of the four that doesn't force a single tradeoff on every sender. |

### 2.2 Revocation

Four related questions, not one:

**A. "Disable link" (a reversible or one-way stop)** — an internal action that marks a specific link inert without generating a replacement. Direct precedent already exists in this codebase (`revokeInvite`, section 1.6) — a status column, a PATCH, a public-page state that shows a neutral "no longer available" message. Open question this raises: is Disable reversible (an "Re-enable" action exists) or final (once disabled, only a brand-new link can ever reopen access)? Your stated preference doesn't specify — flagged in Part 5's open questions.

**B. "Generate new link"** — creates a fresh token for the *same* document version and immediately invalidates the previous one. This is different from "send a new version" (section 1.2): it's for the case where the *content* is still correct but the *link itself* needs to change — e.g., it was pasted somewhere it shouldn't have been, or the client lost the email and asks for a fresh one instead of digging through spam. Real-world example: a PM accidentally pastes a submittal link into a company-wide Slack channel instead of a DM — Generate New Link immediately kills the exposed one without having to re-send the whole document as a new version.

**C. Automatic revocation on new version** — the flip side of section 1.2's finding: should sending v2 automatically disable v1's link, without the sender having to remember to do it separately? This directly closes the "stale v1 approval" scenario in section 1.2. Real-world example: the exact scenario already described — PM corrects a BOM error and sends v2; under this rule, v1's link now shows "a newer version of this document is available" instead of still quietly accepting an Approve click on outdated content.

**D. What happens to links for documents already approved/rejected/revision-requested?** This is genuinely a separate question from A/B/C, because a completed document isn't a security *risk* in the same way an open, respondable one is (there's no "action" left to protect against, only *content visibility*, per section 1.8). Three sub-options, not mutually exclusive:
   - Leave the link exactly as-is (today's behavior) — full content, forever, same URL.
   - Convert it to a read-only, permanently-viewable page (your stated preference) — the response controls are gone (they already are, per section 1.8 — only the *form* is gated), but the document content stays visible with no time limit, on the theory that "what was approved" is a legitimate permanent record both sides may need to reference (a signed submittal is effectively a contract artifact).
   - Apply the same expiration/revocation rules to a completed document as to an open one — i.e., an approved submittal's link could still expire on its own schedule, just like an unopened one.

   Your stated preference picks the middle option explicitly ("a completed response becomes permanently read-only") — this is a real, reasonable default, but it does mean a completed document's link *never* expires under your own expiration rules, which is worth stating plainly since it's an intentional exception, not an oversight.

### 2.3 Customer experience

| Question | Option A | Option B | Real-world note |
|---|---|---|---|
| Expired/revoked link message | A neutral, unexplained message ("This link is no longer available") | A more specific message ("This link has expired" vs. "This link was replaced by a newer version" vs. "This document has been withdrawn") | The existing `phase === "invalid"` page (`main.tsx:24643-24649`) already deliberately collapses "genuinely doesn't exist" and "exists but expired" into one neutral message ("invalid or expired") — worth knowing that some precedent for neutrality already exists, though today it's really "we didn't build expiration yet," not a deliberate privacy choice. |
| Contact information on that page | None | "Contact your Ergon representative" (already the exact wording used today, `main.tsx:24647`) | Today's copy already includes this — a real decision here is only whether to *keep* it once expiration is real, not whether to add it. |
| Completed document stays viewable | Yes (your stated preference, and already true today per section 1.8) | No — completed documents also eventually stop being viewable | If "no," this contradicts your stated preference #5; flagged only to make the contrast explicit, not as a live option you asked to compare. |
| Downloading the completed document | Allowed (proposals already have a "Print / Save as PDF" browser action, `main.tsx:24856-24858` — submittals do not) | Not allowed | Today's proposal page already offers a print/PDF path; submittals never got the equivalent. If completed documents stay permanently viewable (your preference), the print affordance already achieves "downloading" in practice for proposals — submittals would need the same button added to reach parity, a small, low-risk UI addition, not a data-model decision. |

---

## Part 3 — Your stated preference, evaluated against what's actually there

Restating each item plainly, with what it would take given the current architecture, and the sub-question it leaves open:

1. **"Each company can configure a default link lifetime."** Needs a new settings surface — there's no existing "company settings" concept in the schema for this specific idea (the closest existing pattern is `notification_rules`, a company-wide table with per-event defaults — a reasonable structural precedent, not a suggestion to reuse it directly). *Open question: does "company" here mean today's single-tenant app (one row, effectively a constant), or is this meant to anticipate the still-not-built multi-workspace model? Multi-workspace is explicitly out of scope for this document — but the settings screen's shape depends on the answer, so it's worth deciding which one you mean now rather than building the wrong shape twice.*

2. **"The sender can choose a different expiration date before sending."** Directly maps onto the existing "Create & Send" flow (section 1.4) — a date field next to the existing client-name/client-email inputs, pre-filled from #1's default. Straightforward given the architecture.

3. **"Internal users can disable or regenerate a link immediately."** Maps to 2.2's options A and B. *Open question: which internal users? Today, write access to submittals/proposals is PM+admin (submittals) or literally any authenticated user (proposals — "authenticated write sales_quote_proposals... using(true)", section 1.4/`053:132-133`) — a real, existing asymmetry between the two document types that this decision should either deliberately preserve or deliberately close, not inherit by accident.*

4. **"Sending a new document version invalidates the earlier version's response controls."** Maps to 2.2 option C. Note the precise wording you used — *"response controls,"* not *"the link entirely."* That's a meaningfully different (and, given section 1.8, more consistent with your other preferences) choice than fully killing the old link: the old version becomes read-only-viewable (like a completed document) rather than "not found." *Open question: should a superseded old version look identical to a genuinely completed one (both just "read-only, no buttons"), or should the client see something that specifically says "a newer version was sent" so they know to go find it? Section 2.2 lists this as its own message-copy question — this is where it actually matters most, since "superseded" and "approved" are very different situations that would otherwise render as visually identical pages.*

5. **"A completed response becomes permanently read-only."** Already true today, functionally (section 1.8) — the response *form* already disappears once a response is recorded. The only change this preference actually requires is the expiration/revocation carve-out already noted in 2.2.D: a completed document's link must be exempted from whatever expiration/revocation rule otherwise applies, since "permanently" and "expires in 30 days" are contradictory unless completed documents are a deliberate exception.

6. **"Expired or revoked links reveal no customer or project information."** This is the one preference that most directly reverses current, real behavior (section 1.8's finding) — right now, an expired-in-the-future link would still show full content up until the moment `expires_at` actually passes, and a *disabled* link (once that exists) would need the exact same content-hiding treatment as an expired one. Both public-page components already have a natural seam for this: the existing `phase === "invalid"` branch (`main.tsx:24643-24649`/`24832-24838`) already renders *nothing* from the document — no snapshot, no BOM, nothing — so structurally, routing "expired" and "revoked" through that same branch (rather than the "responded" branch, which does show content) is the natural fit, not new design.

7. **"Link access and administrative changes are recorded in an audit log."** The largest genuinely-new piece of work in this list — section 1.7 confirmed *neither* half of this exists today. This wants two distinct things: (a) a *view* log (someone opened the link, whether or not they responded) and (b) an *admin-action* log (someone disabled/regenerated/changed an expiration). Note (a) is meaningfully more invasive than (b) — it means the public, no-login RPC (`get_submittal_by_token`/`get_quote_proposal_by_token`) would need to start writing a row on every read, not just every write, which is a real behavior change to a currently side-effect-free lookup function, worth flagging as its own decision rather than assuming it's bundled for free with (b).

---

## Part 4 — Proposed screens (descriptions, not implementation)

These are illustrative sketches to make the decisions concrete — not a committed design.

**A. Company Settings → Document Links** (new admin-only settings section)
- One field: "Default link expiration" — a number + unit picker ("30 days" / "Never" as an explicit, visible choice rather than an absent value, so "never expires" stays a deliberate setting, not silent default behavior the way it is today).
- A short static explanation line: "Applies to new proposal and submittal links. Senders can choose a different expiration when sending. This does not affect links already sent."

**B. The "Create & Send" dialog** (extends the existing modal at `main.tsx:12616-12634`/`22820-22827`)
- A new "Link expires" field between the existing client-email input and the Create & Send button, pre-filled from setting A, editable per-send.
- If a prior version's link is still open when this is submitted, a short inline notice: "Sending this will replace the response controls on Version {n}'s link." — surfacing preference #4's effect at the moment it happens, not silently.

**C. The internal per-version row** (extends `main.tsx:12638-12666`/`22836-22863`)
- Next to today's single "Copy client link" button: two more — **Disable** and **Generate New Link** (2.2.A/B), each behind a confirmation, each writing an admin-action audit row (preference #7b).
- A small status line under the version header showing the link's own state, independent of the document's `status`: "Link active, expires Oct 5" / "Link disabled by {name} on {date}" / "Superseded by Version {n+1}" — because today, a version's *document* status and its *link's* status are the same one field; once expiration/revocation exist, they're two different lifecycles on the same row, and the UI needs to show both without conflating them.
- A **View access log** link/expander per version (preference #7a), listing timestamped opens if that's the direction chosen.

**D. Customer-facing states** (extends the existing `phase === "invalid"` branch)
- Today's single "Link not found... invalid or expired" copy would need to branch into at least: expired, disabled, and superseded-by-a-newer-version — three different facts, and per item #4's open question above, whether "superseded" gets its own distinct wording or collapses into the same neutral message is a real content decision, not just implementation detail.

---

## Part 5 — Effect on the Sales → Billing → Project process

Traced concretely rather than assumed:

- **Sales → conversion to Project is unaffected either way.** Section 1.5 confirmed `onCreateProjectFromClosedWonQuote` never reads or writes `public_share_tokens`, `sales_quote_proposals`, or anything downstream of a proposal's link. Whatever expiration/revocation rules ship, a quote can still close and convert to a project regardless of whether its proposal's link is still open, expired, or disabled — nothing here blocks or delays that transition. Worth confirming explicitly since it's exactly the kind of hidden coupling that would be easy to introduce by accident if "revoke on completion" were implemented carelessly (e.g., by an ON DELETE or trigger tied to quote status) — it should stay a deliberate non-coupling, not an accidental one.
- **Client Ledger / Billing is unaffected.** Nothing in this document's scope touches invoicing, deposits, or the Client Ledger tables — those don't read `public_share_tokens` or the proposal/submittal tables at all in the parts of the app traced here.
- **The one real process effect is entirely internal, not customer-facing**: preference #4 (new version invalidates the old link's *response controls*) means a PM who sends a corrected version no longer has to remember to separately tell the client "ignore the old email" — today, nothing stops a client from approving the stale one, which is a live risk to the accuracy of what Billing/Project scope is later built from (an approved submittal is presumably the source of truth downstream). Closing this gap is a net positive for process integrity, not a new constraint on it.
- **No existing approval, role, or financial-control boundary changes.** Who can create, approve, or convert a quote/submittal stays exactly as it is today (section 1.4/1.6) — this document's decisions only touch *when a link stops working* and *what it shows once it does*, never *who is allowed to act on the document while it's open*.

---

## Part 6 — Recommendation

Your stated seven-item preference is sound and internally consistent, and matches the architecture better than any single one of the individually-listed alternatives in Part 2 would on its own (e.g., a company default *with* a sender override captures both the "don't make every PM think about it" and the "let the rare case flex" needs that a single fixed rule can't). I'd recommend proceeding with it as the target shape, **once the eight open questions below are answered** — none of them change the overall direction, but several change what gets built first and how big the first version is.

The one place I'd flag for explicit reconsideration rather than just a clarifying question: preference #7's audit log bundles a *view* log and an *admin-action* log together, and the view log is meaningfully more invasive (it turns a side-effect-free public read into a logging write, on every page load, from an unauthenticated caller). If a smaller first version is preferred, admin-action logging (who disabled/regenerated/changed a setting) is the lower-risk, higher-signal half to ship first; view logging is a legitimate but separable follow-up.

---

## Part 7 — Exact questions to answer before implementation

1. **Multi-tenancy shape of "company default"**: is this a single constant (today's single-tenant reality) or should the settings screen already be shaped for the still-unbuilt multi-workspace model? (Multi-workspace itself stays out of scope — this only asks which shape to build now.)
2. **Who is "internal users" for disable/regenerate**: PM+admin only (today's submittal-write gate), or does this also finally close the existing gap where *any* authenticated user can write proposals (section 1.4/3.3)? If the latter, is that a deliberate widening-then-narrowing of the write policy, done as part of this work, or tracked separately?
3. **Is "Disable" reversible?** Does a "Re-enable" action exist, or is Disable final and only "Generate New Link" can restore access?
4. **Does a superseded (old-version) link show distinct wording from an expired link and a revoked link, or do all three collapse into one neutral message?** (Part 3, item #4/Part 4.D.)
5. **Should a completed document's link be exempt from the company's expiration setting entirely** (your preference #5's literal "permanently"), or should it merely get a much longer/separate default than an open document?
6. **Does the audit log cover link views (every public page load) or only admin actions (disable/regenerate/setting changes), or both from day one?** (Part 3, item #7; Part 6's recommendation.)
7. **Should the existing read-exposure gap** (any authenticated user, any role, can currently read every live token and every submittal/proposal row directly via the REST API, section 1.4) **be closed as part of this work, or deliberately left for the separate, already-planned Phase 3 RLS effort?** Either answer is fine — this only needs to be a stated decision rather than an assumption either way, since it affects whether "who can see a link" is actually fixed by this project or just made easier to see in the UI while the underlying database-level exposure remains.
8. **Should soft-deleting a sales quote also disable its proposals' links?** Confirmed live gap (section 1.5): today, "deleting" a quote from the internal UI is a soft-delete that never cascades to its proposals (the `on delete cascade` FK only fires on a real row delete), so every proposal ever sent for that quote — full content, still respondable if still `sent` — stays exactly as public as before. This is really a special case of question 4/5 above (what happens to a link when its *parent* document goes away, not just when the *document itself* is superseded or completed) — worth deciding explicitly rather than assuming "deleted the quote" already means "the link is gone," since today it doesn't.

No implementation, migration, or production change has been made. This document is ready for your review and decisions on the eight items above.

---

## Part 8 — Recorded decisions (filled in as answered, walked through one at a time)

Status: **in progress.** No implementation begins until all 8 are recorded and the resulting final policy is presented back for approval.

1. **Multi-tenancy shape of "company default"** — **DECIDED: build workspace-aware now.** The default-expiration setting will be stored keyed to a company/workspace identifier from the start, rather than as one global constant, even though workspace membership itself isn't built yet. **Flagged for the final-policy review**: this creates a small, deliberate dependency on a piece of the not-yet-built multi-workspace model (a workspace identifier for this one setting to hang off of) — the document's original scope note said multi-workspace stays fully out of scope; this decision narrowly touches its shape (one column/key), not its implementation (membership, isolation, provisioning). Will confirm the exact minimal shape (e.g., a single-row `workspace_id` referencing today's one implicit company) before writing any migration, so this doesn't quietly balloon into real multi-workspace work.
2. **Who can disable/regenerate links** — **DECIDED: role- and stage-based ownership, not a flat PM/admin gate.**
   - **Proposals**: owned end-to-end by **Sales** (`role_key = 'sales'`, an existing role key per migration 040). Sales can create, disable, and regenerate proposal links. **PM has no proposal authority at all.** Managers and admins may retain oversight/emergency access.
   - **Submittals**: authority depends on project stage.
     - **Before handoff** (pre-sale, quote stage): Sales may create and manage a required quote-stage submittal.
     - **After handoff** (sale has become a project, handoff approved): **PM** becomes responsible for revising, resubmitting, disabling, and regenerating the project submittal's links. **Sales retains read-only visibility after handoff** — they can see it, not act on it. Managers/admins may retain oversight access.
   - **Explicit requirement from you**: the handoff must clearly transfer control so Sales and PM can never simultaneously believe they own — and unknowingly manage competing versions of — the same submittal.
   - **Correction this creates against Part 7, item 2's original framing**: the original question assumed "internal users" meant a single role-set applying uniformly to both document types. That assumption is now void — replaced by the ownership model above.
   - **Handoff trigger — DECIDED, with two of its four conditions confirmed MISSING from the app today (verified by direct code trace, not assumed):** submittal authority transfers from Sales to PM only when **all four** of the following are true. Before that, Sales controls quote-stage submittals; after, the assigned PM controls project submittals; Sales keeps read-only access to earlier versions/history. **Signing a proposal alone does NOT transfer authority.**
     1. Billing has marked the required down payment received, or explicitly recorded that none is required. **— MISSING.** Grepped every migration for `deposit`, `down_payment`, `payment_status`, `payment_received`, `invoice_status`, `billing_status` — zero matches anywhere in the schema. The "Client Ledger" (migration 089) tracks `installed_assets`, `kickoff_date`, `warranty_expiration_date` — equipment/warranty records, not payments. **No table or column anywhere records whether a deposit was received, or that none is required, for a quote or project.** This state does not exist and needs to be designed before this trigger can be implemented.
     2. The sale-to-project conversion is approved. **— PARTIALLY EXISTS, informally only.** The conversion action itself is real (`onCreateProjectFromClosedWonQuote`, run when a quote is switched to `closed_won`), but it's gated by nothing more durable than a one-time browser `window.confirm()` dialog — there is no `approved_by`/`approved_at` column, no tracked approval record, no role gate on who can click through it beyond whoever can already edit the quote. **A queryable, auditable "conversion approved" state does not exist today** — only an ephemeral click.
     3. The project record exists. **— EXISTS and is reliable.** Confirmed: `projects.source_sales_quote_id`/`converted_from_quote_at` (migration 064) are set once conversion runs; this part of the trigger can be built on real, already-tracked data.
     4. A PM is assigned. **— MISSING as a structured state.** `project_stakeholders.role` (migration 097) is a free-text field, not a constrained role, and the table stores a plain-text `name`/`email`, not a foreign key to a real `auth.users`/`app_user_roles` account — so even if someone typed "PM" into a stakeholder card, the system has no reliable, queryable way to resolve "who is the assigned PM" to an actual role-gated user account. There is no `projects.assigned_pm_user_id` column or equivalent anywhere.
     - **Per your explicit instruction, no substitute trigger has been silently chosen.** Conditions 1 and 4 need new product decisions (what "down payment received" should actually look like as a data model; how PM assignment should be formally tracked) before this handoff rule can be implemented as written — see the consolidated policy's "missing states" section below.
3. **Disable reversibility** — **DECIDED: three distinct states, not a simple binary.**
   - **Temporarily disable**: reversible by an authorized owner via **Re-enable**. Both the disable action and the re-enable action are recorded in the audit log (ties into Question 6).
   - **Permanently revoke**: a distinct, deliberate action, separate from "temporarily disable" in the interface — requires a confirmation step before it takes effect. Once done, the link is permanently dead; **no Re-enable is possible.**
   - **Superseded by a new version / a regenerated link**: the *old* link also becomes permanently invalid and can never be re-enabled — same permanence as an explicit revoke, just triggered automatically rather than by a direct click.
   - **Explicit UI requirement from you**: "Temporarily disable" and "Permanently revoke and generate a new link" must read as clearly, unmistakably different actions in the interface — not two flavors of the same button — precisely because one is reversible and the other is not.
4. **Dead-link wording** — **DECIDED: three distinct customer-facing messages.**
   - **Superseded**: "A newer version has been sent. Please check your email for the latest link."
   - **Expired**: "This link has expired. Please contact your representative for a new link."
   - **Temporarily disabled OR permanently revoked**: share one neutral message — "This document is currently unavailable. Please contact your representative." The client is never told which of the two happened.
   - **Explicit requirement from you**: the *real* reason (disabled vs. revoked vs. expired vs. superseded) is only ever shown to authorized internal users, via the document's history/audit log (Question 6) — never surfaced to the client beyond the three messages above.
5. **Completed-document expiration** — **DECIDED: longer, still-finite, workspace-configurable default (initially 2 years), not permanent.**
   - The *document itself* remains permanently stored internally, in full, regardless of its public link's state.
   - The *public link* to a completed document gets its own longer expiration window, separate from the (shorter) default for an open/pending document, configurable per workspace (ties into Question 1's workspace-aware settings). Initial value: **2 years**.
   - **Correction against this document's earlier text**: Part 2.2.D, Part 3 item #5, and Part 6's recommendation all previously described your original preference #5 ("permanently read-only") as implying the *link* never expires. That reading is now superseded by this decision — "permanently read-only" describes the internal record, not the public link's lifetime.
6. **Audit log coverage** — **DECIDED: both link views and employee actions, from day one, tracked separately.**
   - **Link views** (client-side, unauthenticated): document, timestamp, success/failure, and only minimum necessary technical detail (no broad fingerprinting). This is the more invasive half flagged in Part 6's original recommendation — you've explicitly chosen to include it rather than defer it.
   - **Employee actions** (internal, authenticated): created, sent, temporarily disabled, re-enabled, permanently revoked, regenerated, superseded, expiration changed — each with who performed it.
   - **Summarized, not raw, in the normal UI**: the everyday activity view shows first viewed / last viewed / total views, not a repetitive entry per view. Full detail is available to authorized users on request, not forced into the primary view.
   - **No notification-per-view**: a client opening the link does not generate a notification each time — this is a passive record, not an alert stream.
7. **Broad internal read-access gap** — **DECIDED: fix it now, narrowly, as part of this work — not the full Phase 3 RLS rollout.**
   - Scope is explicitly bounded by you: restrict *raw share-token* read/manage access to each document's authorized business role (proposals: Sales, per Question 2; submittals: stage-based Sales-then-PM, per Question 2's handoff rule; managers/admins: oversight). An employee who can see the underlying business record (e.g., can read a submittal row) does **not** automatically get the reusable public token for it — those are explicitly two different permissions now, where today they're the same one.
   - **Explicit process requirement from you**: document the exact current access and the proposed new policy, then present the migration for review — **not run it** — before anything changes. (This document does that below; the actual migration SQL still needs to be written and presented separately, same as every other migration this session.)
   - **Explicitly not** authorization to begin the full Phase 3 workspace RLS rollout — this is one narrow policy change on `public_share_tokens` (and the token-visibility half of `sales_quote_proposals`/`project_submittals` read access), not a redesign of the app's broader permission model.
8. **Soft-deleted quotes** — **DECIDED: yes, immediately disable, with restoration requiring a deliberate action.**
   - Soft-deleting a quote immediately disables every active public link on its proposals.
   - The proposal and its full response history remain stored internally for audit purposes — nothing is destroyed.
   - **Restoring the quote does NOT automatically reactivate its old links.** An authorized Sales user must deliberately re-enable an eligible (temporarily-disabled) link, or generate a new one.
   - Links that were already permanently revoked or already superseded before the quote was deleted stay permanently dead — consistent with Question 3's "no re-enable" rule for those two states; quote deletion doesn't create a loophole around it.

---

## Part 9 — Consolidated final policy, v2 (supersedes the v1 draft below in every place they conflict)

All 8 original questions plus all 7 follow-up conflicts are now answered. **No code, schema, or production change has been made.** Presented for your approval before any implementation begins.

### 9.0 A correction that changes several items below: real workspace infrastructure already exists

While verifying item 4 (workspace bootstrap), I found that **Phase 1 of the workspace/multi-tenancy foundation is already built and live** — `backend/supabase/migrations/115_workspaces_foundation.sql`, whose own header says "approved by E after three review rounds." This materially changes the v1 draft's assumption that no workspace concept exists yet:

- Real tables already exist: `workspaces` (one real row, seeded by migration 115), `workspace_members`, `workspace_member_roles`, `platform_admins` — plus working, tested helper functions `is_workspace_admin()`, `is_workspace_member()`, `can_manage_workspace_member()`, all `security definer`/`search_path=''`-hardened, matching this session's own established discipline.
- **Correction, verified directly**: migration `116_rename_first_workspace_to_ergon_test.sql` was created, run, and live-verified (per HANDOFF.md's own record: the returned row showed `name: "Ergon Test Workspace"`, `slug: "ergon-test"`, `status: "active"`). It's a single idempotent `update workspaces set name = 'Ergon Test Workspace', slug = 'ergon-test' where slug = 'ensight'` — an `UPDATE`, not a delete-and-recreate, so the row's **`id` (the primary key) is unchanged** by this rename. That `id` is now proven to be the only stable identifier — the slug and name have already changed once in this project's own history, which is direct evidence neither should ever be depended on. **Every reference in this policy to "the workspace" now means: the one row in `workspaces` identified by its immutable `id`, currently displayed as name "Ergon Test Workspace" / slug `ergon-test` — never a hardcoded dependency on either of those two mutable fields.**
- Existing role/admin assignments were already copied into these tables when migration 115 ran (`workspace_member_roles` mirrors `app_user_roles`; `workspace_members.is_workspace_admin` mirrors `app_admins`).
- There is exactly one real workspace row, today displaying as "Ergon Test Workspace" (`slug='ergon-test'`, post-migration-116). This is the workspace item 4 refers to — nothing else matching that name exists anywhere in the schema.

**But — and this is the contradiction to surface, per your request**: this infrastructure is **not yet wired into any actual authorization check anywhere in the app.** I checked directly: `has_role()` (migration 023) and `is_app_admin()` (migration 012) — the two functions every single existing RLS policy in this entire app calls, including every policy this document's earlier parts have cited — both still query `app_user_roles`/`app_admins` (the *old* tables), not `workspace_member_roles`/`workspace_members` (the *new* ones). Migration 115's own comment admits this plainly: its `current_user_workspace_ids()` helper is "not called by any existing code yet, and not wired into any route by this migration."

**Practical consequence for items 3 and 4**: building the new Billing role/capability system on the new (`workspace_member_roles`) tables — which is what "workspace-aware... keyed to the workspace_id" genuinely requires — makes this feature the **first real consumer** of infrastructure the rest of the app doesn't use yet. If someone's role changes through today's existing UI (which still only writes to `app_user_roles`), that change will **not** automatically appear in `workspace_member_roles` unless something keeps the two in sync. Surfaced as an open item in 9.7, not silently resolved either way.

### 9.1 Database/workflow states that don't exist today and must be designed

All eight original items are now resolved in *shape*, by your seven follow-up decisions plus the top-of-message direction. Table updated to reflect that — "resolved" here means the data model is decided, not yet built.

| # | State | Current reality | Resolution |
|---|---|---|---|
| 1 | **Down payment clearance** | Confirmed missing — no table/column anywhere. | **RESOLVED.** New field(s) recording one of `required / received / waived / not_required`, plus who recorded it and when. Lives on the project (or the quote, pre-conversion — see 9.7 item 3). |
| 2 | **A "Billing" role/actor** | Confirmed missing — no such role exists. | **RESOLVED.** A default `billing` role is created for onboarding clarity, but authorization runs through **capabilities**, not a hardcoded role check (see 9.1 new item 9 below). |
| 3 | **Sale-to-project conversion as a tracked approval** | Confirmed informal — a bare `window.confirm()`. | **RESOLVED.** Two-party model: Sales submits for conversion; a different person holding the `approve_sale_to_project_conversion` capability approves (after billing clearance exists); admin may emergency-override with a mandatory reason, audited. A stored record (submitter, approver, timestamps) replaces the confirm dialog entirely. |
| 4 | **A formal, structured "assigned PM" field** | Confirmed missing — free-text stakeholder role only. | **RESOLVED.** A new field connects a project to a real **`workspace_members`** row (not a free-text name) — see 9.0's correction: this deliberately uses the already-existing, already-live workspace infrastructure rather than inventing a parallel one. |
| 5 | **Link lifecycle state** | Confirmed missing — no status columns on `public_share_tokens` at all. | **RESOLVED.** `status` (`active` / `temporarily_disabled` / `permanently_revoked` / `superseded`), `disabled_at`/`disabled_by`/`disabled_reason`, `revoked_at`/`revoked_by`/`revoked_reason`, a self-reference for what superseded a row. |
| 6 | **Workspace-aware settings storage** | Originally believed not to exist — **corrected in 9.0**: it already does. | **RESOLVED.** Every new settings/role/capability table keys to `workspace_id uuid references public.workspaces(id)`, pointed at the one real row's immutable `id` — never its `slug` or `name`, both of which have already changed once (migration 116). No new workspace is created; nothing is seeded as demo data. |
| 7 | **Two expiration durations** | Confirmed missing — one never-set column, no open/completed distinction. | **RESOLVED.** Two duration fields on the workspace settings row: open-document default, completed-document default (initial value 2 years). |
| 8 | **Audit log storage** | Confirmed missing entirely. | **RESOLVED.** Two tables: link views (minimal technical detail) and employee/admin actions (full actor + reason where applicable) — see 9.4. |
| 9 | **A general-purpose capability system** *(new, required by decision 3)* | Does not exist — no precedent found anywhere in the schema (grepped for any existing capability/permission-mapping table; zero hits). | **NEW WORK, not yet designed in detail.** A `capabilities` catalog (fixed list of capability keys) and a `workspace_member_capabilities` grant table (which real member holds which capability), admin-editable through UI, no code deploy required to change an assignment. Reused for every capability this policy needs: Billing's four capabilities, conversion approval, and the manager/admin override capabilities (item 10). |
| 10 | **Manager/admin override with mandatory reason + notification** *(new, required by decision 1)* | No override mechanism or reason-capture exists for any document type today. | **NEW WORK.** A `manager_link_override`/`admin_link_override`-style capability, an action that requires a non-empty reason field before it completes, and a notification fired to the document's actual owner (never to the acting overrider themselves) — reuses the existing, already-working notification system from migrations 119–123. |
| 11 | **PM reassignment as a tracked event** *(new, required by decision 2)* | No reassignment concept exists — `project_stakeholders` has no history/versioning. | **NEW WORK.** An explicit reassignment action (old member → new member, who performed it, when) that instantly flips submittal authority but deliberately does **not** touch any live share link — link state changes only ever happen through a separate, deliberate manager action. |
| 12 | **Quote soft-delete/restore as distinct, joinable audit events** *(new, required by decision 6)* | `deleteSalesQuote`/its restore counterpart change `deleted_at` but create no event history of their own today. | **NEW WORK.** `quote_soft_deleted` and `quote_restored` become real logged events on the quote, cross-referenced into each affected proposal's own history so the four-step story (deleted → auto-disabled → restored → deliberately re-enabled) reads as one coherent timeline, not four disconnected facts. |

### 9.2 Proposed permissions matrix — capability-based

"Business record" = the actual document content as seen inside the app. "Raw token/link" = the actual share URL — a separate permission from viewing the record, per your original decision 7. Capability names shown are proposed keys, not final until Stage 1 schema review.

| Actor | View record | View/copy raw link | Create / disable / re-enable | Permanently revoke / regenerate | Notes |
|---|---|---|---|---|---|
| **Sales** (proposals) | ✅ | ✅ | ✅ | ✅ | Full ownership, per decision at the top of your message. |
| **Sales** (submittals, pre-handoff) | ✅ | ✅ | ✅ | ✅ | Same as proposals until handoff conditions (9.1 items 1/3/4) are all met. |
| **Sales** (submittals, post-handoff) | ✅ | ❌ | ❌ | ❌ | Read-only, explicitly — authority has transferred. |
| **The specific assigned PM** (submittals, post-handoff) | ✅ | ✅ | ✅ | ✅ | Scoped to *that* project's assigned `workspace_members` row, not every PM-role holder — this is what 9.1 item 4's real field makes enforceable. |
| **Other PM-role employees** (not assigned to that project) | ❌ | ❌ | ❌ | ❌ | Confirmed by your decision — authority is per-project, not per-role. |
| **Manager holding `manager_link_override`** | ✅ | ✅ (only mid-action) | ✅ (with mandatory reason, audited, owner notified) | ✅ (same) | For coverage/escalation, not standing access. |
| **Admin holding `admin_link_override`** | ✅ | ✅ (only mid-action) | ✅ (with mandatory reason, audited, owner notified) | ✅ (same, incl. emergency conversion-approval override) | For emergency recovery, not standing access. |
| **Holder of `record_down_payment_status`/`record_billing_clearance`** (default: `billing` role) | ✅ (handoff-relevant fields only) | ❌ | ❌ | ❌ | Capability-gated, not role-hardcoded — could be reassigned to another role by a workspace admin later. |
| **Holder of `approve_sale_to_project_conversion`** (default: manager) | ✅ (conversion record) | ❌ | ❌ | ❌ | Cannot be the same person who submitted the sale for conversion. |
| **Other employees** (warehouse, purchasing, etc.) | ❌ | ❌ | ❌ | ❌ | Unchanged from the original decision. |
| **Client (via their own link)** | n/a | n/a (their own link only) | n/a | n/a | No visibility into activity logs or other versions. |

### 9.3 Screens and controls

Extends Part 4/9.3's original sketches with everything decided since:

- **Settings → Document Links** (workspace-scoped, keyed to the real workspace's `id`): two duration fields (open/completed defaults).
- **Settings → Capabilities** *(new screen, required by decision 3)*: a table of capability keys down one axis, roles across the other, checkboxes an admin can toggle — no code change required to move a capability from one role to another later.
- **Create & Send dialog**: only appears for whichever of Sales/PM currently holds authority per handoff state; the other side sees read-only.
- **Per-version row**: **Temporarily Disable** / **Re-enable** as one control pair, **Permanently Revoke & Generate New Link** as a visually separate, confirmation-gated action (decision 1's UI requirement, unchanged). A manager/admin acting here sees a **required reason field** before the action completes.
- **Project detail view** *(new, required by decision 2)*: a **Reassign PM** action — picks a new assigned `workspace_members` row, instantly flips authority, sends the three notifications (old PM, new PM, manager), leaves any live link untouched.
- **Quote detail view**: soft-delete now shows a real timeline — deleted → each proposal's link auto-disabled — rather than a single flip with no explanation; restoring the quote shows the same timeline continuing, explicitly noting links stay disabled until a Sales user deliberately acts.
- **Sale-to-project conversion**: replaces the `window.confirm()` with a real screen — Sales submits, shows pending-approval state, a capability-holder (not the submitter) approves or returns it to Sales for correction; admin emergency-override path clearly marked as exceptional, reason required.
- **Customer-facing pages**: three dead-link states (superseded / expired / unavailable), unchanged from the prior round.

### 9.4 Audit events

**Link views** (one row per public page load): `document_type`, `document_id`, `timestamp`, `result`, minimal technical detail only.

**Employee/admin actions** (each carrying `actor_workspace_member_id`, `timestamp`, and a `reason` field that's required for override actions, optional otherwise):
`created`, `sent`, `temporarily_disabled`, `re_enabled`, `permanently_revoked`, `regenerated`, `superseded`, `expiration_changed`, `workspace_default_changed`, `manager_override`, `admin_override`, `pm_reassigned` (old member, new member), `down_payment_status_recorded`, `billing_clearance_recorded`, `handoff_returned_to_sales`, `conversion_submitted`, `conversion_approved`, `conversion_emergency_overridden`, `quote_soft_deleted`, `disabled_by_quote_deletion` (cross-referenced to the `quote_soft_deleted` event that caused it), `quote_restored`, and `link_reenabled_after_quote_restore` (the deliberate Sales action, distinct from the earlier automatic disable).

### 9.5 Staged implementation plan

Reordered from the prior draft: nearly all of the original "Stage 0" blocking product decisions are now resolved in shape (schema still needs writing — that's normal engineering work, not an open decision). Your item 7 process (pre-activation review report, then post-activation confirmation report) is now built into the sequence explicitly, at the exact point you specified.

- **Stage 1 — Core schema**: link lifecycle state (9.1.5), two-tier expiration (9.1.7), the two audit log tables (9.1.8), workspace-scoped settings keyed to the real workspace's `id` (9.1.6). Implements the compatibility bridge (9.7 item 1, now decided) as part of this stage, since later stages depend on it.
- **Stage 2 — Handoff schema**: down-payment/billing-clearance fields, the conversion-approval record table, the assigned-PM field (referencing `workspace_members`), the capability catalog + grant table, the default `billing` role and its four capabilities seeded.
- **Stage 3 — Pre-activation report** *(your item 7, first report)*: a read-only report — every real user in the `ensight` workspace, their current roles, and the proposed new roles/capabilities for each. **You review and approve the actual business assignments here — nothing is guessed.** Produced only after Stage 1+2 schema and default capability definitions exist, and only once I have a way to run a genuinely read-only query against production for you to review (matching this session's standing practice: I prepare the exact SQL, you run it, or I run it read-only if/when that becomes available to me in this session — to be confirmed at that point).
- **Stage 4 — RLS/permissions activation**: narrows `public_share_tokens` and proposal/submittal read/write policies to the 9.2 matrix, capability checks wired in. **Only proceeds after Stage 3's report is approved.**
- **Stage 5 — Post-activation report** *(your item 7, second report)*: confirms the approved assignments from Stage 3 actually took effect as configured.
- **Stage 6 — RPCs**: disable/re-enable/revoke/regenerate, auto-supersede-on-new-version, auto-disable-on-quote-soft-delete (and its restore counterpart), PM-reassignment transfer, two-party conversion-approval flow, override-with-reason + notification.
- **Stage 7 — Frontend**: every screen in 9.3.
- **Stage 8 — Testing & migration review**: transaction-safe SQL test script, presented for review before anything runs in Supabase — same standing process as migrations 119–123.

### 9.6 Decisions recorded for the seven follow-up conflicts

1. **Manager/admin override notification** — **DECIDED.** Yes: overriding an action on someone else's document notifies the responsible Sales person or assigned PM. Actor, action, timestamp, and required reason are logged. The customer is never notified solely because an internal override occurred. The acting manager/admin is never notified about their own action.
2. **PM reassignment cutover** — **DECIDED.** Instant transfer on save. Former PM loses management authority but keeps normal read-only visibility their project involvement already allows. Active customer links are never automatically touched by a reassignment. Old PM, new PM, and the relevant manager are notified; the event is recorded. A manager can separately disable/regenerate a link afterward if the reassignment specifically requires it.
3. **Billing — role vs. capability** — **DECIDED.** A default `billing` role exists for onboarding clarity, but every actual permission runs through capabilities: `view_billing_handoff_items`, `record_down_payment_status`, `record_billing_clearance`, `return_handoff_to_sales`. A workspace admin can reassign these to a different role later with no code change. No free-text role is ever used for authorization.
4. **Workspace-aware bootstrap** — **DECIDED, and corrected by the 9.0 finding.** Everything keys to the real, already-existing workspace row (seeded by migration 115, renamed by migration 116 to "Ergon Test Workspace"/`ergon-test`) — by its **immutable `id`**, never its slug or display name, both of which have already changed once. No second workspace is created; nothing is exposed as demo data. Future workspace onboarding gets its own setup process later, out of scope here.
5. **Conversion approval** — **DECIDED.** Two-party: Sales submits; the submitter cannot also be the approver. Billing clearance must exist first. A manager (or anyone else holding `approve_sale_to_project_conversion`) approves. Admin emergency override requires a reason and is audited. The browser confirm dialog is fully replaced — it is never treated as approval.
6. **Quote-deletion cascade audit event** — **DECIDED.** Yes, a distinct event, and further split into the full four-step timeline: quote soft-deleted → proposal link auto-disabled (as a consequence) → quote restored → a Sales user deliberately re-enables or regenerates. Restoring a quote never auto-reactivates its links.
7. **Pre-launch role-assignment check** — **DECIDED, and sequenced exactly where you specified.** A read-only report (real users, current roles, proposed new roles/capabilities) is generated after schema + default capability definitions exist but before restrictive policies activate (Stage 3 above) — you approve the actual business assignments, nothing is guessed. A second report after activation (Stage 5) confirms the approved assignments took effect.

### 9.7 The four open items — decision recorded for item 1, recommendations for all four

#### 9.7.1 — DECIDED: a documented, bounded compatibility bridge (not a permanent dual system)

Full policy, exactly as specified:

1. The workspace tables (`workspaces`, `workspace_members`, `workspace_member_roles`) are the destination architecture and sole authority for every newly built workspace-aware feature in this project: capabilities, billing clearance, assigned-PM authority, link management.
2. Existing features may keep using `app_user_roles`/`app_admins`/`has_role()`/`is_app_admin()` until their policies are deliberately migrated and tested during Phase 3. Nothing about this project forces that migration.
3. Any role-management operation touching both systems goes through **one reviewed, transactional, server-side function or route** — all required records update, or none do.
4. No unrestricted bidirectional triggers. No hidden sync loops. Ownership of each write stays explicit.
5. A read-only **drift report** compares legacy assignments against workspace membership/roles — run before the new feature is enabled, and again during post-activation verification.
6. New capabilities exist **only** in the workspace-aware system — never represented in the legacy role tables.
7. Legacy global admin (`app_admins`) and workspace-admin (`workspace_members.is_workspace_admin`) are different concepts. A workspace admin is never automatically promoted to global admin.
8. This bridge is permitted only while the current workspace remains the sole operational one — legacy roles have no workspace dimension, so this is unsafe the moment a second workspace exists. Onboarding a second workspace is blocked until Phase 3's isolation work removes this dependency.
9. Removal plan: Phase 3 migrates existing authorization checks/RLS policies in tested groups, then retires the compatibility writes, then deprecates the legacy role/admin tables entirely.

**Trace: every current role-management writer, and what it does today** (all five are direct client-side `fetch()` calls straight to PostgREST from `src/persistence.ts` — none goes through any server-side function or route today; all are gated only by RLS's `is_app_admin(auth.uid())`, migration 012):

| Function | `persistence.ts` | Table(s) written today | What it does |
|---|---|---|---|
| `setPrimaryUserRole` | :677 | `app_user_roles` | Deletes the old primary-role row, upserts the new one as `is_primary=true`. |
| `setSecondaryUserRoles` | :718 | `app_user_roles` | Deletes all `is_primary=false` rows, re-inserts the given set. |
| `setUserAllowedViews` | :653 | `app_user_roles` | PATCHes `allowed_views` on the existing primary-role row. |
| `grantAdmin` | :1976 | `app_admins` | Inserts a row. |
| `revokeAdmin` | :1995 | `app_admins` | Deletes the row. |

**A sixth function exists but is dead code, confirmed by grep — zero call sites in `main.tsx`**: `setUserRole` (`persistence.ts:1953`). It's a stale duplicate of `setPrimaryUserRole` that predates migration 040's schema change (its `on_conflict=user_id` targets a unique constraint that no longer exists as a single-column key). It does nothing today. Flagged because if anyone ever revives it without knowing about the bridge, it silently writes only to `app_user_roles` and bypasses the new system entirely — recommend deleting it as part of Stage 1, not leaving it as a landmine.

**Proposed bridge mapping, per point 6 and 7 above:**

| Operation | Legacy write (unchanged) | New-system write (added) | Direction |
|---|---|---|---|
| `setPrimaryUserRole` | `app_user_roles` | `workspace_member_roles` (same role_key, `is_primary=true`, on the caller's single membership row) | Symmetric — same concept exists in both. |
| `setSecondaryUserRoles` | `app_user_roles` | `workspace_member_roles` (`is_primary=false` set) | Symmetric. |
| `setUserAllowedViews` | `app_user_roles.allowed_views` | **None.** `workspace_member_roles` has no equivalent column, and per point 6, this project shouldn't add one for a legacy-only concept it isn't otherwise touching. | Legacy-only, not bridged. |
| `grantAdmin` | `app_admins` | `workspace_members.is_workspace_admin = true` | **One-directional only**, per point 7: legacy→new is fine (there's only one workspace right now, so a global admin genuinely is that workspace's admin); the reverse must never be automatic. |
| `revokeAdmin` | `app_admins` (delete) | `workspace_members.is_workspace_admin = false` | Same direction, mirrored removal. |
| New capability grants (Billing, conversion-approval, overrides) | *(none — no legacy equivalent)* | `workspace_member_capabilities` | New-system-only, per point 6. Nothing to disagree with. |
| New assigned-PM field | *(none — no legacy equivalent)* | `projects` → `workspace_members` | New-system-only. |

**A required, easy-to-miss prerequisite**: `workspace_member_roles.role_key` currently carries the exact same check-constraint list as `app_user_roles.role_key` (migration 115's own comment: "copied verbatim... must become workspace-configurable before a second company"). Adding `billing` as a role means widening **both** check constraints, in the same migration, or the bridge write for a Billing-role assignment will fail on one side.

**Where the two systems could actually disagree — four concrete scenarios, not hypothetical:**

1. **Likely already true, right now, before any code changes.** Migration 115 copied `app_user_roles`/`app_admins` into the new tables as a one-time snapshot at the moment it ran. Any role or admin-status change made through the app *since* migration 115 (via the five functions above) has only ever landed in the legacy tables — nothing has been writing to the new ones. **The drift report (point 5) needs to run before Stage 1 begins, not just before the new feature activates**, to find out how far the two tables have already diverged.
2. **Direct SQL in Supabase Studio** — the normal, frequent way changes get made in this project (every migration this session has been applied this way). A manual fix or data correction run directly in Studio touches whichever table the SQL names and nothing else, silently bypassing the bridge function entirely. This is a real operational risk specific to how this project actually works, not a generic hypothetical.
3. **RLS still permits direct writes to the legacy tables** even after the bridge function exists — point 3 requires role-management operations to *go through* the bridge function, but nothing in points 1–9 says to revoke `app_admins`'/`app_user_roles`' own `"admins manage all roles" for all ... using(is_app_admin(...))` policy (migration 012), and point 2 explicitly says legacy features keep using it. That means the five existing functions must be **rewritten to call the new bridge function instead of hitting the tables directly** — simply adding the bridge function without retiring the old direct-write call sites leaves the old, unsynced path fully alive alongside it.
4. **The dead `setUserRole` function**, if ever resurrected without anyone checking history first, silently writes only to `app_user_roles`.

**Recommendation**: build the bridge as a single Postgres `security definer` RPC per operation (`bridge_set_primary_role`, `bridge_grant_admin`, etc. — or one general-purpose function if the shape allows), matching this session's established hardening pattern (`search_path=''`, fully qualified, narrow grants) — and **replace**, not just supplement, the five existing `persistence.ts` functions' internals to call these RPCs instead of raw PostgREST. This directly closes risk #3. The drift report (point 5) should be the very first thing built and run, before any other Stage 1 work, to establish a real baseline rather than assuming today's two tables already agree.

#### 9.7.2 — Where does down-payment clearance live: the quote, or the project?

**My recommendation: the quote.** Your handoff rule requires clearance to exist as one of the gate conditions *before* a project formally exists (condition 1, checked alongside conditions 2–4) — so the record has to be attachable to something that's already there at that point, which can only be the quote. At conversion time, the clearance record (or a reference to it) carries forward onto the new project, the same way `projects.source_sales_quote_id` already carries the quote reference forward today (migration 064). This keeps the pattern consistent with how conversion already works, and avoids a chicken-and-egg problem where clearance would need a project that clearance itself is a precondition for.

#### 9.7.3 — Is the proposed capability list final?

**My recommendation: treat it as the working draft, finalized at Stage 2's schema review, not before.** The four Billing capabilities, `approve_sale_to_project_conversion`, `manager_link_override`, and `admin_link_override` are my minimum proposed set inferred from your instructions — reasonable to build from, but Stage 2 (when the actual schema gets written) is the right, concrete checkpoint to adjust names or granularity, rather than trying to guess every edge case now before any of it is real.

#### 9.7.4 — Real-world role-assignment verification

**Already resolved, no action needed.** This was originally its own open question; your decision on item 7 (Question set 2) folded it into Stage 3's pre-activation report with exact sequencing (after schema+capabilities exist, before restrictive policies activate) and Stage 5's post-activation confirmation. Restating here only for completeness, per your request to list all four together.

---

## Part 10 — 9.7.1–9.7.4 approved with 7 additional requirements; Stage 1 prepared locally, not deployed

**SUPERSEDED BY PART 11.** This section documents the *first draft* of migration 124, which E's review (below) found seven real issues in — including this section's own text incorrectly saying "four rewritten functions" when a fifth live writer (`setUserAllowedViews`) had been missed entirely. Left in place as the historical record of what that draft contained; **do not treat anything in Part 10 as the current state** — see Part 11 for the corrected version of everything described here.

Status: **local artifacts only — migration `124_workspace_authorization_bridge.sql` has NOT been run in Supabase, no restrictive policy has been activated, no second workspace created, Phase 3 not begun.** Everything below is ready for review.

### 10.1 Your seven requirements, recorded

1. **Drift report first.** Standalone, read-only SQL (`backend/supabase/drift_report_standalone.sql`) prepared, covering all six required categories, runnable immediately against production — independent of migration 124, which does not need to exist for it to work. **Not yet run** — no live DB access exists in this session; per this project's standing process, you run it manually and share the real results. Discrepancies are reported, never auto-resolved.
2. **Fully close the bypass path.** Recorded as a deliberate two-step sequence, not done in one migration: this round (124) only adds the bridge RPCs and switches the five frontend call sites to use them. **Narrowing/removing the legacy tables' direct-write policies is explicitly deferred to a later, separate migration**, run only after 124 is confirmed live and correct — matching your own "after the replacement RPCs are ready and tested" phrasing. The three verification requirements (handcrafted direct write rejected; authorized RPC succeeds; unauthorized/cross-user/cross-workspace operations fail) are written into `migration_124_bridge_tests.sql` for the parts testable now (authorization, atomicity, the active-workspace guard) — the "direct write rejected" check specifically requires the *not-yet-built* policy-narrowing migration to exist first, so it's written into that future migration's own test script, not fabricated here against policies that don't exist yet.
3. **Transitional source of truth.** Implemented exactly as specified in `bridge_grant_admin`/`bridge_revoke_admin`: one-directional only (legacy → workspace), a workspace admin is never auto-promoted to `app_admins`. The active-workspace guard (`active_workspace_id()`) blocks the bridge the moment a second active workspace exists, enforced at the database level, not just documented.
4. **Direct Supabase Studio changes.** Documented here, not enforced in code (correctly — a database owner's SQL access cannot be technically restricted by anything at the application layer, and this policy doesn't pretend otherwise): any emergency Studio SQL touching role/membership data must be recorded (what and why), followed immediately by re-running the drift report, reconciled through an approved script, and the affected account verified before the change is considered closed.
5. **Dead `setUserRole`.** Re-confirmed via a fresh whole-project grep immediately before removal — zero call sites in `main.tsx`, no test file referenced it, no dynamic string-based reference anywhere. Removed from `persistence.ts` entirely, with a comment recording why (dead code, plus its `on_conflict=user_id` target hadn't matched any real constraint since migration 040 changed the table's key shape — it could never have worked correctly even if called). `tsc --noEmit` and the full test suite both clean after removal (see 10.3).
6. **Billing clearance location.** Confirmed: lives on the quote (per 9.7.2's recommendation, now approved). At conversion, a read-only snapshot (status, recorded-by, recorded-at, required amount if applicable, waiver/not-required reason) copies onto the project's handoff record — the quote's own clearance history is never overwritten, only carried forward as a snapshot. **Not yet built** — this is Stage 2 schema work, out of scope for migration 124, which is bridge-only.
7. **Capabilities.** Confirmed as a working draft, finalized at Stage 2's schema review (per 9.7.3's recommendation, now approved). Business logic checks capabilities, never hardcodes a role name — already the design migration 124's own bridge functions follow (`is_app_admin()` is a legacy compatibility check specifically, not a stand-in for a capability check; new Stage 2 features will check capability grants instead).

### 10.2 What was actually built this round (local only)

- **`backend/supabase/drift_report_standalone.sql`** — the six-category read-only drift report, runnable now, independent of migration 124.
- **`backend/supabase/migrations/124_workspace_authorization_bridge.sql`** — `active_workspace_id()` (the single-workspace guard, enforced at the DB level), `bridge_set_primary_role()`, `bridge_set_secondary_roles()`, `bridge_grant_admin()`, `bridge_revoke_admin()`, and `bridge_drift_report()` (a reusable, admin-gated RPC version of the standalone report, for the post-activation re-check bridge point 5 requires). Every function: `security definer`, `search_path=''`, fully schema-qualified, explicit `revoke...from public`/`from anon` + `grant...to authenticated`, internal `is_app_admin(auth.uid())` check (server-derived, not caller-trusted), and the active-workspace guard. **Deliberately does not touch any existing RLS policy** — the legacy tables' direct-write access is untouched in this migration, per requirement 2's sequencing.
- **`backend/supabase/migration_124_bridge_tests.sql`** — transaction-safe (`begin;`/`rollback;`, never commits), using real existing users rather than fabricated accounts. Covers: non-admin caller rejected; admin caller succeeds and both systems write atomically in one call; an invalid role_key writes to neither table (atomicity); the drift report correctly surfaces a deliberately-introduced mismatch; the active-workspace guard correctly refuses to proceed when a second active workspace exists (inserted and tested entirely inside the rolled-back transaction — nothing persists). **Cannot be run yet** — it calls functions migration 124 creates, which doesn't exist in production until you approve and run it.
- **`src/persistence.ts`** — `setPrimaryUserRole`, `setSecondaryUserRoles`, `grantAdmin`, `revokeAdmin` rewritten to call `rpc/bridge_*` instead of writing `app_user_roles`/`app_admins` directly. `setUserRole` deleted entirely.
- **`src/role-bridge.test.ts`** (new) — 9 tests confirming each of the four rewritten functions calls the correct RPC endpoint with the correct body shape, and still throws a clear error on failure.

### 10.3 Test evidence (real, actually run)

- `npx tsc --noEmit` — clean, no errors.
- `npx vitest run` — **15 test files, 133 tests, all passed** (up from 124 tests before this round's 9 new ones).
- `npx vite build` — clean production build (the one warning shown is a pre-existing chunk-size notice, unrelated to this change).
- The SQL test script (`migration_124_bridge_tests.sql`) has **not** been run — it depends on migration 124 existing in production, which it doesn't yet. Presented ready to run immediately after you approve and apply the migration.

### 10.4 Plain-English summary

Nothing in production changed. Four admin-only "change someone's role" actions in the app now go through new database functions instead of writing directly to the old role table — but those new functions don't exist in the live database yet, because the migration that creates them hasn't been run. The functions are designed so that whenever someone's role changes, the change gets recorded in *both* the old system (which the rest of the app still relies on) and the new, more capable system (which this whole project is building toward) — in a single, all-or-nothing step. A leftover, unused piece of old code that could have caused confusion later was found and removed. A safety check was added that refuses to let any of this run if the app ever ends up with more than one company/workspace in it at once, since that's specifically when this bridge would become unsafe. Before any of this goes live, a read-only report needs to be run against the real data to check whether the old and new systems already disagree about anyone's role — that report is ready to run now and doesn't require anything else to happen first.

---

## Part 11 — Migration 124, revision 2: seven issues corrected, still not approved to run

Status: **still local artifacts only. Migration 124 has NOT been run, nothing has been deployed, no restrictive policy activated, no second workspace created, Phase 3 not begun, nothing committed to git.** This section is the current, accurate state of everything — supersedes Part 10 in full, and is updated in place (not appended as a new conflicting section) as further review rounds land.

### 11.0 Real drift-report results — clean

You ran `backend/supabase/drift_report_standalone.sql` against production. Result: **"Workspace check passed. Blocks 1a–6d all returned no rows."** Every discrepancy category — legacy users missing workspace membership, workspace users missing legacy presence, role-set differences, primary-role differences, admin-status differences, and every dangling/duplicate-assignment check — came back empty, and the workspace-count/status check (block 0) passed. **The two authorization systems agree completely, right now, before any bridge code runs.** This is the real baseline the drift-detection tests in `migration_124_bridge_tests.sql` are written against — it does not itself authorize running migration 124.

### 11.1 The eleven issues found across two review rounds, and what changed

**Round 1 (7 issues):**

1. **`is_app_admin(uuid)` itself was unhardened.** It's called internally by every bridge function, and by every single existing RLS policy in the app (18 files, all using the identical `is_app_admin(auth.uid())` shape) — but had no `search_path=''` and referenced `app_admins` unqualified, exactly the class of bug migration 123 found live. **Fixed**: redefined with `search_path=''` and `public.app_admins`, same signature, same logic, same return value. Verified every one of the 18 existing callers is unaffected — they call it from ordinary (non-search-path-restricted) RLS contexts, so hardening the function's *internal* behavior is invisible to them. Documented plainly in the migration's own comment: any authenticated caller can ask "is user X an admin?" for an arbitrary X, not just themselves — a pre-existing fact (the grant predates migration 124), not something this hardening introduces or changes.
2. **`bridge_set_secondary_roles()` had no primary-role protection.** **Fixed**: now verifies, before writing anything — the target has a legacy primary role; a workspace membership already exists (never creates one); a workspace primary role exists; the legacy and workspace primary roles actually agree; and the requested secondary set doesn't include the primary role itself. Any failure aborts before either table is touched.
3. **`setUserAllowedViews()` — the real fifth writer — was missed.** **Fixed**: new `bridge_set_user_allowed_views()` RPC, legacy-only (no workspace-side equivalent exists for `allowed_views`, correctly not invented), admin-gated, requires exactly one primary-role row to exist (fails clearly on zero or duplicate), touches only the `allowed_views` column. Wired into `persistence.ts`. **All prior text in this document claiming "four" writers were replaced was wrong — it's five, and all five are now bridged.**
4. **`active_workspace_id()` only checked the active count, not the total.** A second, merely-*suspended* workspace would have passed the old check. **Fixed**: now requires exactly one workspace row in total, and that row must be active — correctly rejects a second active workspace, a second suspended one, and zero workspaces, all with the same two-step check.
5. **`bridge_revoke_admin()` had no final-admin protection.** Could have revoked the last global admin, locking the app's own admin-management screen with no recovery path short of a manual DB fix. **Fixed**: counts current admins before writing; if the target is the sole remaining admin, rejects with a clear error before touching either table. Applies identically to self-revocation — no special-cased logic needed, same check either way.
6. **Test coverage was too narrow.** **Fixed**: `migration_124_bridge_tests.sql` rewritten, now covering every item in your list — see 11.3.
7. **The standalone drift report was missing detail.** **Fixed**: now shows every workspace's own status (not just an active count), joins `app_known_users` for a readable email beside every UUID, and includes the explicit `workspace_id` on every workspace-side discrepancy row. Still entirely read-only.

**Round 2 (4 more issues, found in review of round 1's fixes):**

8. **`bridge_set_user_allowed_views()` didn't call the workspace guard.** It changes a global legacy permission and must respect the same single-workspace safety invariant as every other transitional writer, even though its own write never touches a workspace table directly. **Fixed**: now calls `active_workspace_id()` before any write. Four new tests added proving it fails with no data change when there are zero workspaces, a second active workspace, a second suspended workspace, or when the sole workspace is suspended. (The zero-workspace case is deliberately tested at the very end of the script, not alongside the other three — see item 10.)
9. **Final-admin protection had a real concurrency race, and a second gap.** The "count admins, then decide" sequence wasn't safe against two concurrent revocations of two *different* admins — under READ COMMITTED isolation, both could independently see "count > 1, safe" before either committed, and both proceed, leaving zero admins despite neither individual check being wrong in isolation (ordinary row-level locking doesn't help here, since the two `DELETE`s target different rows and never conflict with each other). **Fixed**: `bridge_revoke_admin()` now takes a transaction-scoped Postgres advisory lock (`pg_advisory_xact_lock`) before checking or writing anything, forcing concurrent calls to serialize — whichever call is blocked re-counts against the other's already-committed result once it acquires the lock. Documented in the migration's own comment why this specific lock is needed, and why a literal two-session test isn't something a single-connection SQL script can perform — the guarantee rests on Postgres's own documented advisory-lock semantics (the same category of trust already placed in a UNIQUE constraint), not on empirically racing two sessions. **Second gap, also fixed**: the function used to unconditionally flip `workspace_members.is_workspace_admin = false` for the target even if they were never in `app_admins` at all — meaning it could silently strip workspace-admin status someone had been granted through some other, independent path. Now rejects outright with a clear error if the target isn't currently a global admin, and leaves their workspace-admin status completely untouched in that case.
10. **Test assertions only caught "an exception happened," not "nothing was written."** **Fixed**: every failure-path test (invalid roles, primary-role collisions, drift rejection, unauthorized calls, final-admin rejection, the new "not currently an admin" rejection) now snapshots both the legacy and workspace-side rows (or the specific column under test) before the call and re-compares them afterward for exact equality, not just that *some* exception was thrown. Also fixed the fixture-collision risk you flagged: `no_role_user_id`'s selection query now explicitly excludes `non_admin_user_id`, so the two can never resolve to the same row and silently invalidate the "no primary role yet" tests once `non_admin_user_id` gets a role assigned earlier in the script. **A genuine bug found while making this fix, not requested but corrected regardless**: the most natural way to test "zero workspaces" for `bridge_set_user_allowed_views` would have deleted the real workspace row mid-script — which cascades away every `workspace_members`/`workspace_member_roles` row hanging off it, including the fixture user's own membership built up earlier, and re-inserting a bare workspace row afterward does **not** resurrect those cascaded child rows. Moved that one sub-case to run last, alongside the already-last-positioned `active_workspace_id()` zero-workspace test, where nothing later in the script depends on the fixture surviving intact.
11. **Skipped sections could end a run looking like unconditional success.** **Fixed**: the script now tracks skipped-section names in an array, and the final block is a hard `raise exception` naming every skip if `skipped_count > 0` — a partial run can no longer finish as bare "Success. No rows returned." The only way this script now ends cleanly is the literal notice `ALL MIGRATION 124 BRIDGE TESTS PASSED — ZERO SECTIONS SKIPPED`, or a hard SQL error.

### 11.2 Revised migration — what's in it now

`backend/supabase/migrations/124_workspace_authorization_bridge.sql`: `is_app_admin(uuid)` (hardened), `active_workspace_id()` (strengthened total-row-count guard), `bridge_set_primary_role()` (unchanged since draft 1 — no issue found in either review round), `bridge_set_secondary_roles()` (primary-role protections), `bridge_set_user_allowed_views()` (new in round 1, now also calls the workspace guard per round 2), `bridge_grant_admin()` (unchanged), `bridge_revoke_admin()` (final-admin protection, now concurrency-safe via an advisory lock, and rejects a non-admin target instead of silently touching their workspace-admin status), `bridge_drift_report()` (unchanged in shape, benefits from `is_app_admin`'s hardening automatically). Still deliberately does not touch any existing RLS policy, does not add `has_role()`/`is_app_manager()` hardening (same latent issue, explicitly out of scope for this round, not overlooked), does not add `billing` to any role_key constraint, and creates no capability/clearance/PM-assignment schema — all still Stage 2.

### 11.3 Revised test script — now covers every item across both review rounds

`backend/supabase/migration_124_bridge_tests.sql`, still `begin;`/`rollback;`, still never commits, still uses real existing users rather than fabricated ones. Every assertion — success and failure alike — goes through the real authenticated execution path (`role='authenticated'` + a real `request.jwt.claims` sub), and every failure-path assertion now snapshots the relevant legacy and workspace-side state before the call and re-verifies exact equality afterward, not just that some exception was caught. Ten sections: `is_app_admin` correctness + the documented "queryable for any user" fact; anonymous execution rejected at the grant layer (snapshot-verified); primary-role non-admin rejection (snapshot), admin success, invalid-role failure (snapshot); secondary-role success, empty-list clearing, invalid-role rejection (snapshot), primary-role-collision rejection (snapshot), primary-role-drift rejection (snapshot), no-primary-role rejection (with proof no empty membership gets created), and the isolated "primary role exists but workspace membership specifically doesn't" case; allowed-views unauthorized rejection (snapshot), success (role assignment preserved), no-primary-role rejection, duplicate-primary-row rejection (snapshot), and three of its four workspace-guard scenarios (second active, second suspended, sole suspended); drift-report authorization and correctness; admin grant unauthorized-rejection (snapshot), the new "not currently an admin" rejection (proving workspace-admin status granted independently is never silently stripped), final-admin self-revocation rejection (full snapshot including workspace-admin status), revoke-one-of-multiple success; the general `active_workspace_id()` guard's remaining scenarios (one active succeeds; second active fails; second suspended fails; zero workspaces fails — including, right alongside it, `bridge_set_user_allowed_views`'s own fourth guard scenario, deliberately deferred to here for the cascade-safety reason in item 10 above); and a direct `information_schema.role_routine_grants` check confirming zero `anon`/`PUBLIC` grants and exactly the expected `authenticated` grants across every function.

**Skip handling**: any section missing its real-data prerequisite is tracked by name in an array, not silently omitted. The script can only end one of two ways — the literal notice `ALL MIGRATION 124 BRIDGE TESTS PASSED — ZERO SECTIONS SKIPPED`, or a hard `raise exception` naming every skipped section, per your explicit "must fail visibly" requirement. **Still cannot actually be run** — depends on migration 124's functions already existing in production, which they don't yet.

### 11.4 Local verification, rerun after every change above (both rounds)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **15 test files, 136 tests, all passed** (unchanged this round — no frontend files were touched; 133 before round 1's 3 new `bridge_set_user_allowed_views` tests).
- `npx vite build` — clean (same pre-existing, unrelated chunk-size warning).
- The SQL test script still cannot run against real data in this session — same reasoning as before, restated in 11.3.
- The real drift report (11.0) came back completely clean — no discrepancies found in production today.

### 11.5 Corrected plain-English summary

Nothing in production changed. A real, read-only check of the live data found the old and new role-tracking systems already agree on everything today. **Five**, not four, admin-only role-management actions are rewired to go through new database functions instead of writing directly to the old role table, and all five — including the one that changes what tabs someone can see — now respect the same "don't run this if the app ever has more than one company in it" safety check. Two of the new functions double-check real preconditions before doing anything, so they won't demote a person's main role by accident, won't act on someone whose two record-keeping systems already disagree about their role, and won't silently create a half-finished membership record. The safety check that blocks everything the moment a second company/workspace exists now also catches a second one that's merely "paused," not just one that's live. A new safeguard stops anyone from removing the very last administrator account — including themselves — and it's now protected against two admins trying to revoke different people at the exact same moment, a real timing gap that could otherwise have left zero admins even though neither person's individual check was wrong. That same safeguard no longer silently strips someone's workspace-level admin status by mistake if they were never a global admin to begin with. Every test that proves something was correctly *rejected* now also proves nothing was quietly written anyway, not just that an error appeared. And the test script itself can no longer report success while quietly skipping something it couldn't actually check — it either passes everything cleanly, or it errors out and says exactly what it couldn't verify.

---

## Part 12 — Migration 127 policy-closure plan (design SQL only — not drafted as a runnable migration)

**Renumbered twice now, both times for the same reason**: first from "migration 125" to migration 126 when the urgent `is_app_admin` anon-grant fix (Part 13.1) needed that slot; now from 126 to **127**, because migration 126 was needed for a second, unrelated urgent fix found live — `bridge_drift_report()`'s ambiguous-column bug (Part 13.3). This plan remains design-only and has never existed as a real file or run — it simply keeps moving to the next available slot as real, more urgent fixes take the numbers ahead of it.

Status: **design-only**, per your own instruction: migration 124's SQL test results haven't been confirmed, so this is not drafted as an actual numbered migration file yet — it's the reviewable plan for what that migration will contain once 124 is fully tested and deployed. Not run, not deployed, no policy touched.

### 12.1 What this migration will actually do

Once 124 is live and its bridge RPCs are the ONLY way the app itself changes a role, this migration closes the loophole that currently lets anyone with `authenticated`'s existing grants write `app_user_roles`/`app_admins` directly via raw PostgREST, bypassing the bridge (and, later, bypassing whatever RLS actually enforces access once Phase 3 lands). Concretely:

- **Narrow `app_user_roles`'s write policy.** Today: `"admins manage all roles" for all to authenticated using (is_app_admin(auth.uid())) with check (...)` (migration 012) — any admin can write ANY row directly. Replace with a policy that only permits writes where the row's `user_id = auth.uid()` **AND** the write is happening as part of accepting a still-valid, not-yet-accepted invite (see 12.3) — i.e., narrow this down to essentially nothing for direct client writes, since every legitimate admin-driven change now goes through a bridge RPC (a `security definer` function, which bypasses RLS for its own writes regardless of the calling policy — this is why closing the *policy* doesn't break the *RPCs*).
- **Narrow `app_admins`'s write policy** the same way — direct client writes closed; `bridge_grant_admin`/`bridge_revoke_admin` remain functional because they're `security definer`.
- **Keep both tables' SELECT policies exactly as they are.** Nothing in this plan touches read access — `"admins read all roles"`, `"users read their own role rows"`, etc. all keep working exactly as before. This migration is write-only in scope.
- **Add a policy permitting the one legitimate non-bridge writer this migration must NOT break: invite acceptance.** See 12.3 — this needs its own dedicated design, not just a blanket "close everything."

### 12.2 Writer audit results (complete — ran overnight, findings below)

The full writer audit confirmed the five bridge-routed functions are the only direct writers reachable from `main.tsx`, and confirmed `accept_invite()` (its real name — not `accept_user_invite`) as a genuine, unbridged gap, with its exact location now pinned down: defined in `041_user_invites.sql:75-121`, redefined (current version) in `065_fix_accept_invite_stale_expiration.sql:17-63`, called via `rpc/accept_invite` from `persistence.ts:900`. It is `security definer`, writes `app_user_roles` (delete-then-upsert primary role + loop-inserted secondary roles) and `app_user_status`, **never** `app_admins` (confirmed: `user_invites` has no admin-granting column, and the role vocabulary it accepts is the same non-admin set as everywhere else). It has never written the workspace side at all — every invited user who has ever accepted an invite has a legacy role but no `workspace_members`/`workspace_member_roles` row, a real, already-existing drift source (the drift report Section 0/1a category would have caught this if any invites had been accepted since migration 115 ran — worth specifically re-checking if the drift report is ever re-run and shows anything in that category).

**Two structural findings beyond the writer inventory itself, both changing this migration's scope:**

1. **The already-known gap, confirmed precisely**: `"admins manage all roles"` and `"admins manage admin list"` (migration 012, both `FOR ALL using (is_app_admin(auth.uid()))`) are still fully open — any admin's own JWT can write `app_user_roles`/`app_admins` directly outside the app UI (curl, Postman, devtools), with zero mirroring into the workspace side. This is exactly what 12.1 already planned to close.
2. **A NEW, previously-unidentified reverse-direction gap**: `workspace_members`/`workspace_member_roles` have the *exact same* kind of open `FOR ALL` policy (migration 115: `"workspace admins manage memberships in their own workspace"`, gated by `is_workspace_admin(workspace_id)`/`can_manage_workspace_member(...)`) — and **today's sole real admin already has `is_workspace_admin = true`** (confirmed live, per `PRODUCT_PHASE1_PLAN.md`'s own verification: exactly one such row, the same account). This means a write straight to the *new* tables, bypassing every bridge RPC, is equally possible **today**, drifting the workspace side away from the legacy side that every existing RLS policy in the app actually reads. None of migration 124's five bridge RPCs guard against this direction — they only guard the legacy→workspace direction. **This migration's scope must expand to close this policy too**, not just the two originally planned — closing only the legacy-table policies while leaving the workspace-table policies open would leave the exact same class of bug alive, just pointed the other way.

**No other writers found.** No `auth.users` insert trigger exists anywhere (grepped, zero matches — signup itself seeds nothing automatically). User approval (`app_user_status`) never touches any of the five/four tables in scope — a fully separate action from role assignment. The platform-admin bootstrap and the original `app_admins` seed are both one-time, human-triggered, superuser-context Studio actions, orthogonal to RLS/RPC closure entirely (not gated by any `authenticated`-role policy in the first place, so this migration has no effect on them either way).

### 12.3 The invite-acceptance problem, and its design

Your framing is exactly right: `accept_user_invite()` cannot simply call an admin-only bridge RPC, because the caller IS the newly-signed-up invitee, not an admin — `bridge_set_primary_role()`'s own `is_app_admin(auth.uid())` check would correctly reject them, since they aren't one.

**The design principle**: the invite record itself is the authorization. An admin already exercised their authority once, at the moment they created a valid, not-yet-expired, not-yet-accepted invite carrying a specific `role_key` (and, if the invites table supports it, admin-granting power — to be confirmed by the writer audit, see below). Accepting that invite doesn't need a SECOND admin-authorization check; it needs proof the invite itself is real, current, and matches the person accepting it.

**Proposed shape** (function name/exact columns to be confirmed against `accept_user_invite()`'s real current signature, pending Task 2's audit — not guessed here):

```sql
create or replace function public.bridge_accept_user_invite(invite_token text)
returns table (outcome text, role_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role_key text;
  ws_id uuid;
  member_id uuid;
begin
  -- Validate the invite exactly as accept_user_invite() already does
  -- today (expiration, not-already-accepted, matches auth.uid()'s
  -- email) -- exact validation logic to be carried over verbatim from
  -- the current function once its real definition is confirmed, not
  -- redesigned here.
  ...validation...

  if <invite invalid> then
    return query select 'invalid_or_expired_invite'::text, null::text;
    return;
  end if;

  -- The invite's own existence, having passed validation, IS the
  -- authorization -- no is_app_admin() check here, deliberately: the
  -- caller is the invitee, not an admin, and that's expected.
  ws_id := public.active_workspace_id();

  insert into public.app_user_roles (user_id, role_key, is_primary, updated_at)
  values (auth.uid(), target_role_key, true, now())
  on conflict (user_id, role_key) do update set is_primary = true, updated_at = now();

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
  values (ws_id, auth.uid(), false)
  on conflict (workspace_id, user_id) do nothing;

  select id into member_id from public.workspace_members where workspace_id = ws_id and user_id = auth.uid();

  insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
  values (member_id, target_role_key, true)
  on conflict (workspace_member_id, role_key) do update set is_primary = true;

  -- Mark the invite consumed -- exact column/table per the real schema.
  update public.user_invites set status = 'accepted' where token = invite_token;

  return query select 'success'::text, target_role_key;
end;
$$;
```

This mirrors `bridge_set_primary_role()`'s dual-write shape exactly, just with the invite's own validity substituted for an admin-authorization check — same atomicity guarantee (one function body, one implicit transaction), same `active_workspace_id()` guard, same `search_path=''`/full-qualification discipline. **Marked explicitly as not-yet-finalized**: the exact validation block, the invites table's real column names, and whether an invite can ever carry admin-granting power (which would need a `bridge_grant_admin`-style mirror into `app_admins` too) all depend on Task 2's confirmed read of the real `accept_user_invite()` definition — this shape is the design, not the final SQL.

### 12.4 Required test coverage for migration 127 (design, not yet written)

- **Handcrafted direct-write rejection**: after the policy narrows, a raw PostgREST `POST`/`PATCH`/`DELETE` against `app_user_roles`/`app_admins` (simulated the same way this session's tests simulate `role='authenticated'`) must fail with a permissions error.
- **Authorized bridge success**: every one of migration 124's five bridge RPCs still succeeds end-to-end after the narrowing (proves the RPCs' `security definer` ownership genuinely bypasses the now-closed policy, as expected).
- **Unauthorized operation rejection**: unchanged from 124's own tests — still enforced at the RPC's internal check, now ALSO enforced at the table level as defense-in-depth.
- **Invite acceptance success**: a real, valid invite fixture (created the same way `accept_user_invite()`'s own existing test coverage does, if any exists — to be confirmed) is accepted via `bridge_accept_user_invite()` and results in the correct `app_user_roles` + `workspace_member_roles` rows, atomically.
- **Atomic legacy/workspace updates**: same snapshot-before/after discipline as migration 124's own test script, applied to the new invite function.
- **Drift report remaining clean**: `bridge_drift_report()` run at the end of the test script returns zero rows — proves the narrowed policy didn't leave any write path capable of updating one system without the other.
- **Exact rollback**: `drop function` for any new function this migration adds (`bridge_accept_user_invite`), and re-creating the original (pre-126) policies on `app_user_roles`/`app_admins` verbatim from migration 012/010's text.

### 12.5 Production verification order (once 124 is deployed and this migration is eventually approved)

1. Run the standalone drift report (already proven clean once — re-run for a fresh baseline immediately before this migration, not relying on the earlier result).
2. Run this migration.
3. Run its test script (same transaction-safe, snapshot-verified, hard-fail-on-skip pattern as 124's).
4. Manually attempt one handcrafted direct write from outside the app (a raw `curl`/REST call) and confirm it's rejected — the one test category that genuinely can't be simulated inside a `begin;`/`rollback;` script run by the same privileged Studio connection, since Studio's own connection may not be subject to the same RLS policy a real `authenticated` PostgREST caller is.
5. Send a real invite through the app's own UI and confirm a real acceptance succeeds end-to-end (the one thing the SQL test script can only fixture-simulate, not prove through the actual frontend flow).
6. Re-run the drift report once more, post-deployment, confirming still clean.

---

## Part 13 — Overnight autonomous pass: urgent fix + authorization helper audit

### 13.1 RESOLVED: `is_app_admin(uuid)` shipped with a missing `anon` grant revoke — confirmed live, migration 125 run, fix verified

**Status: closed.** The pre-migration query (13.1a) confirmed the exposure was real, not just inferred: `anon` held live `EXECUTE` on `is_app_admin`, `can_manage_workspace_member`, `current_user_workspace_ids`, and (per the same result set) the remaining workspace helpers. Migration 125 was run. The post-migration verification query (13.1b) confirms all seven functions now show `anon_still_has_execute = false` / `authenticated_has_execute = true`. This section is kept as the historical record of the finding, the fix, and its confirmation — not an open item.

Found by an overnight audit of every `security definer` authorization helper in the codebase. Confirmed by direct re-read of `backend/supabase/migrations/124_workspace_authorization_bridge.sql`, exactly as applied (this file has not been retroactively edited — see the correction note below): every OTHER function hardened in that migration (`active_workspace_id`, all five `bridge_*` functions, `bridge_drift_report`) has the full three-line grant pattern — `revoke all from public`, `revoke execute from anon`, `grant execute to authenticated`. `is_app_admin(uuid)` alone was applied with only two of the three lines — no `revoke execute ... from anon`.

**Why this matters**: `revoke all ... from public` does **not** touch a grant made separately to `anon` — this project has `alter default privileges in schema public grant execute on functions to anon, authenticated, service_role` set at the project level, documented once already by migration 118 (which found and fixed the identical gap for a different function pair, `resolve_caller_workspace_id`/`guard_workspace_id_mutation`). `is_app_admin()` was originally created in migration 012 with no grant statements at all, so it inherited that default `anon` EXECUTE grant at creation, and nothing between then and migration 124 ever revoked it.

**What was confirmed vs. what was inferred, and the live result**: it was always a confirmed fact that migration 124, as applied, never issued a `revoke execute ... from anon` for `is_app_admin(uuid)`. Whether `anon` still held that grant today was, until you ran 13.1a, a strong inference from the documented default-privilege behavior, not a direct read. **You ran it — the result confirmed `anon` held live `EXECUTE` on `is_app_admin` and on the workspace helper functions.** The exposure was real, not hypothetical.

**Practical impact, as it stood before the fix**: any fully unauthenticated caller could have called `POST /rest/v1/rpc/is_app_admin` with an arbitrary user id and learned whether that specific user was a global admin. Narrow (a boolean, requires already knowing/guessing a real user id — not a path to actually gaining admin access), but real, and on the app's most-relied-upon check.

**Correction to earlier text in this document, preserved for the record**: an earlier pass here incorrectly edited `124_workspace_authorization_bridge.sql` itself to add the missing revoke line, and incorrectly said migration 126 was the fix. Both were wrong and were corrected before anything ran: migration 124's file was restored to exactly what was applied (never retroactively edit an applied migration — the same standing rule this whole project has followed since migration 117→118, 119→121). The real fix, **migration 125** (`backend/supabase/migrations/125_fix_authorization_helper_anon_grants.sql`), has now been run and verified. It also closed the same class of gap on the six migration-115 workspace helper functions (`is_platform_admin`, `is_workspace_admin`, `is_workspace_member`, `is_workspace_member_owner`, `can_manage_workspace_member`, `current_user_workspace_ids`) — confirmed live-exposed by the same pre-migration query, now closed and verified by 13.1b.

### 13.1a Read-only live-grant inspection query — run BEFORE the fix, confirmed exposure real

```sql
select routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name in (
    'is_app_admin', 'is_platform_admin', 'is_workspace_admin',
    'is_workspace_member', 'is_workspace_member_owner',
    'can_manage_workspace_member', 'current_user_workspace_ids'
  )
order by routine_name, grantee;
```

Entirely read-only — a `SELECT` against `information_schema`, no writes possible.

**Real result, confirmed**: `anon` had `EXECUTE` on every one of the seven functions (`is_app_admin`, `is_platform_admin`, `is_workspace_admin`, `is_workspace_member`, `is_workspace_member_owner`, `can_manage_workspace_member`, `current_user_workspace_ids`) — alongside `authenticated`, `postgres`, and `service_role`, exactly the "default project privilege, never revoked" pattern this document predicted. The exposure was real, not hypothetical.

### 13.1b Migration 125 — run, and post-migration verification — confirmed clean

```sql
select
  routine_name,
  bool_or(grantee = 'anon') as anon_still_has_execute,
  bool_or(grantee = 'authenticated' and privilege_type = 'EXECUTE') as authenticated_has_execute
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name in (
    'is_app_admin', 'is_platform_admin', 'is_workspace_admin',
    'is_workspace_member', 'is_workspace_member_owner',
    'can_manage_workspace_member', 'current_user_workspace_ids'
  )
group by routine_name
order by routine_name;
```

**Real result, confirmed**: migration 125 ran ("Success. No rows returned"). This verification query then returned `anon_still_has_execute = false` and `authenticated_has_execute = true` for all seven functions — `can_manage_workspace_member`, `current_user_workspace_ids`, `is_app_admin`, `is_platform_admin`, `is_workspace_admin`, `is_workspace_member`, `is_workspace_member_owner`. The gap is closed and verified. `authenticated`'s own access (which every existing RLS policy and the migration-124 bridge RPCs depend on) is confirmed unaffected.

### 13.2 Full authorization-helper audit, ranked

Every `security definer` function used by an RLS policy or acting as an auth check, audited for: missing `search_path=''`, unqualified references, grant narrowness (including the `anon`-default-privilege trap above), caller-supplied-id exposure, RLS-recursion risk, workspace ambiguity, and suspended-workspace behavior.

1. **`is_app_admin(uuid)` (migration 124)** — see 13.1. **Fixed and verified live** (migration 125, run and confirmed clean).
2. **`has_role(text)` (migration 023)** — no `search_path`, unqualified `app_user_roles`, no grant narrowing at all (still on the project's default `anon`/`authenticated`/`service_role` grant). This is the **highest-blast-radius unhardened function in the codebase** — it gates roughly 20 write policies across inventory, purchasing, projects, catalog, and sales-quote tables (migrations 023, 024, 025, 026, 028, 033, 045, 046, 053). No caller-supplied-id exposure risk (uses `auth.uid()` internally only, not an arbitrary parameter) — that part of its design is actually already correct. **Not fixed tonight** — deliberately deferred, per your explicit "do not broadly rewrite helpers overnight" instruction; flagged as the top candidate for an explicitly-approved future hardening pass, given its usage breadth exceeds even `is_app_manager`'s.
3. **`is_app_manager(uuid)` (migration 014)** — same defect class as `has_role` (no `search_path`, unqualified, no grant narrowing) plus a caller-supplied `check_user_id` (same arbitrary-user-query exposure as pre-fix `is_app_admin`). Guards fewer but real policies (`app_user_status`, `team_members`, `notification_rules`). Migration 124's own header comment already named this as a known, explicitly-deferred sibling of `is_app_admin` — confirmed still true. **Not fixed tonight**, same reasoning as #2.
4. **The six migration-115 workspace functions** — confirmed genuinely well-designed on 4 of 5 criteria (full `search_path`/qualification, and a deliberately safer pattern of never accepting an arbitrary "check this OTHER user" id — each only ever answers "can the current caller do X"). Two real gaps found: (a) likely share the anon-grant gap (addressed in migration 125, 13.1); (b) **`is_workspace_admin`/`is_workspace_member` don't check `workspaces.status`** — a member of a *suspended* workspace is treated identically to a member of an active one, unlike `resolve_caller_workspace_id()` (117) and `active_workspace_id()` (124), both of which correctly reject suspended workspaces. Real design inconsistency between the two "generations" of workspace helpers; low current impact only because `platform_admins` ships empty and workspace suspension isn't yet an enforced concept anywhere live. Worth closing whenever these six are next touched, not urgent tonight.
5. **`resolve_caller_workspace_id()`/`guard_workspace_id_mutation()` (migration 117, grants fixed by 118)** — confirmed as the **best-designed function pair in the codebase**: full hardening, correctly rejects suspended workspaces, correctly disambiguates zero/one/multiple memberships with distinct errors. Held up as the reference pattern, not a finding.
6. **`get_users_by_role`/`get_admin_emails` (123)** and **`get_quote_proposal_by_token`/`respond_to_quote_proposal`/`get_submittal_by_token`/`respond_to_submittal` (119/121/122)** — confirmed fully hardened, no gaps found on any of the five criteria.
7. **`get_invite_by_token`/`accept_invite` (041/065)** — unqualified/no-`search_path`, but `get_invite_by_token`'s `anon` exposure is intentional (a pre-login lookup, by design); `accept_invite` immediately rejects a null `auth.uid()`, so its likely-still-open `anon` grant (per the same default-privilege pattern) has low practical risk. Both flagged for hardening whenever `accept_invite` itself gets its bridge treatment (Part 12.3), not urgent standalone.
8. **`acquire_transaction_lock` (069)** — not an authorization helper, flagged only for pattern consistency: uses `search_path = public` rather than `''`, the only place in the codebase using that weaker variant.

**No broad rewrite performed tonight, per your explicit instruction.** Only 13.1's finding got an actual fix prepared (migration 125) — everything else above is audit and ranking only, awaiting an explicit future approval to act on.

### 13.3 `bridge_drift_report()` ambiguous-column bug — found live during the bridge-test run, migration 126 RUN and applied

**What happened**: you ran `migration_124_bridge_tests.sql`. It reached Section 7 (drift-report authorization + correctness) and failed with `42702: column reference "user_id" is ambiguous`, inside `bridge_drift_report()` itself.

**Root cause**: `bridge_drift_report()` declares `returns table (check_name text, user_id uuid, detail jsonb)` — in plpgsql, those output column names become implicit variables in scope for the whole function body, exactly the bug class that hit `respond_to_quote_proposal()` during migration 119's live debugging (Postgres 42702). Two of the function's nine `UNION ALL` branches reference a table with no alias inside a derived subquery, before that subquery itself gets aliased:

```sql
from (select user_id, role_key from public.app_user_roles where is_primary) l   -- bare user_id
...
full outer join (select user_id from public.workspace_members where is_workspace_admin) w  -- bare user_id
```

Every other branch already aliased its source table directly (`l`, `aur`, `wm`), which is why only these two broke. **This fails unconditionally on every call** — not data-dependent — so `bridge_drift_report()` has never successfully executed since migration 124 was applied. No other function in migration 124 shares this exposure: it's the only one with a `RETURNS TABLE` shape (the rest return `void` or a scalar).

**Consequence for the test run**: no exception handler wrapped this specific call, so the whole script aborted here. **Sections 8, 9, and 10 — admin grant/revoke (including the final-admin and concurrency-lock protections), all four workspace-guard scenarios, and the routine-grants check — never ran.** Nothing about them is confirmed working or broken; they're simply unverified. Nothing persisted (the script never reached a commit either way).

**Fix applied**: `backend/supabase/migrations/126_fix_bridge_drift_report_ambiguous_column.sql` — took the next real slot (see Part 12's renumbering note). Both subqueries get an explicit table alias (`aur`, `wm`), matching the pattern every other branch already uses. Same signature, same return shape — `create or replace function`, no `DROP` needed. **Run by E in Studio, confirmed ("Success. No rows returned" on the closing `commit;`).** Not yet re-verified by an actual call to `bridge_drift_report()` — the migration applying cleanly confirms the SQL is syntactically valid and was accepted, not that the function now executes correctly; that's what the next step confirms.

**Next step**: `migration_124_bridge_tests.sql` needs to be re-run in full — not just re-verifying Section 7, since Sections 8–10 have never executed at all yet, in either direction.

### 13.4 Test-script defect found on the full re-run — a destructive DELETE against real, FK-referenced production data

The re-run reached the zero-workspace scenario and failed: `ERROR 23503: deleting the real workspace violates clients_workspace_id_fkey`. The script's own zero-workspace test did `delete from public.workspaces where id = real_workspace_id` to simulate that case — and this is a genuinely populated production database, not an empty fixture: both `clients.workspace_id` and `sales_quotes.workspace_id` are real, `NOT NULL` foreign keys to that row (migration 117). **This is a defect in the test script, not in migration 124's production code.** Wrapping the statement in `begin;`/`rollback;` did not make attempting it safe — the `DELETE` itself failed on referential integrity before rollback was ever relevant, and deliberately attempting a destructive operation against real FK-referenced rows is the wrong instinct for a test script regardless of whether it would have succeeded.

**Fixed, per your explicit instructions**: the real-workspace DELETE and its dependent `bridge_set_user_allowed_views` zero-workspace test are removed entirely — there is no way to safely make `public.workspaces` truly empty in this database without first removing every real client and sales quote. The three remaining live scenarios (one active succeeds; second active fails; second suspended fails; sole workspace suspended fails) are unchanged, still executed for real. The zero-workspace case is now verified **structurally** instead (new Section 9b): `pg_get_functiondef()` (read-only, touches no data) confirms `active_workspace_id()`'s actual deployed source counts *all* workspace rows and rejects on `total_count <> 1` — the same branch the executed two-workspace tests already prove runs and rejects, satisfied by zero exactly as much as by two — and confirms `bridge_set_user_allowed_views()`'s source calls `active_workspace_id()` before its `UPDATE`. Both are real assertions (raise `TEST FAILED` and abort if the pattern isn't found) that count as **PASS**, not a skip.

Full corrected `migration_124_bridge_tests.sql` delivered to E (sent as a file, not pasted into chat — chat pasting of the full 1000+ line script made it hard to scroll back to instructions; file delivery is now the default for any full-file handoff). **Not yet run.**

### 13.5 Full clean run — Gate 1's precondition is met

E ran the corrected script (revision 4). Result: **"Success. No rows returned," no error.** By the script's own design, this is a strong result, not an ambiguous one: both a genuine test failure (`raise exception 'TEST FAILED: ...'`) and any skipped section (the final `if skipped_count > 0 then raise exception ...` block) always surface as a hard error in Studio — there is no code path that reaches a quiet, error-free finish without having fired the literal final notice `ALL MIGRATION 124 BRIDGE TESTS PASSED -- ZERO SECTIONS SKIPPED`. **This is the first time the full bridge-test suite — all of Sections 1 through 10, including 9b's structural verification — has completed successfully.**

**What this confirms, concretely**: every bridge function's authorization check, atomicity guarantee, and drift-detection logic now behaves as designed against real production data — `is_app_admin`/`active_workspace_id`/all five `bridge_*` writers/`bridge_drift_report`, the primary-role and secondary-role protections, the final-admin and concurrency-lock protections on revoke, all workspace-guard scenarios (including the structurally-verified zero-workspace case), and the routine-grants check. Nothing was skipped; nothing failed.

**What this does NOT yet mean**: migration 124's bridge work is still local — not committed, not pushed, not deployed. Gate 1's original action list (record result, commit + push, wait for Vercel, verify the Admin page live, call `bridge_drift_report()` through the authenticated production app, confirm the deployed bundle uses all five bridge RPCs) has **not** been executed. That list was defined before migrations 125 and 126 existed — whatever gets committed now needs to include those two as well, which wasn't part of the original scope. **Awaiting E's explicit go-ahead before taking any of Gate 1's remaining steps.**

---

**Migration 125 (13.1) is run and verified — closed.** **Migration 126 (13.3) is run and applied.** **The bridge-test script (13.4's defect, now fixed) ran clean in full (13.5) — Gate 1's precondition is met, but none of Gate 1's actions (commit, push, deploy, live verification) have been taken.** Migration 127's policy-closure plan (Part 12) is still design-only. Nothing has been committed to git.
