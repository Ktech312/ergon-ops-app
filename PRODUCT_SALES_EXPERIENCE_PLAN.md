# Sales Product Experience — Concept Plan (First Pass)

Status: **design-only, first-pass concept produced during an overnight autonomous work session, lighter depth than the other documents produced the same night.** Not implemented. Goal: keep the HubSpot/PandaDoc-equivalent functionality inside Ergon itself, per the stated product direction, rather than building a thin wrapper around either.

## The flow

**Marketing lead → Sales opportunity → quote → presentation/proposal → signature → Billing review → clearance → project conversion → PM handoff.**

Everything from "quote" onward already exists in some real form in this codebase (sales quotes, BOM lines, the proposal system built this session's earlier work touched extensively). The gap is earlier (lead → opportunity, no evidence found of a dedicated stage for this yet) and later (Billing review/clearance/conversion-approval — entirely Stage 2 work, not yet built).

## Screen-level concepts (concept only, not wireframed)

- **Fast quote creation**: a "start from a template" picker at quote-creation time (see Sales templates below), pre-filling BOM structure and boilerplate so a rep isn't building every quote from a blank page.
- **Reusable workspace templates**: template quotes/proposals a rep can clone, distinct from the shared boilerplate `proposal_template_sections` (migration 053) that already exists — templates would be starting *content*, boilerplate is fixed *legal text*. Two different concepts that shouldn't be conflated in the UI.
- **Brand controls**: already partially real (`company_branding`, migration 039) — extend to control the proposal page's own visual presentation (logo placement, accent color) once that's workspace-scoped (Stage 9's onboarding plan).
- **Visual proposal sections**: the current proposal page (`ProposalPublicPage`, extensively traced this session) already renders images per BOM line (`imageUrl`) and structured template sections — a real foundation, not a gap. The concept work here is giving Sales more layout control (section ordering, optional hero image) rather than inventing the rendering pipeline from scratch.
- **Product/media libraries**: the catalog (`product_catalog`) already carries images/descriptions/datasheets per item — reused directly by proposals today. No new library needed; extending catalog item media richness (multiple images, video) is the actual open question.
- **Pricing accuracy**: out of this pass's depth — flagged as needing its own investigation into how BOM-line pricing is currently derived/frozen at quote time vs. catalog price changes afterward (the catalog price-change-request workflow, migrations 046/108, suggests this is already a live concern elsewhere in the app worth cross-referencing).
- **Optional packages**: no evidence found of a "bundle" concept in the current BOM model — a real gap, not yet designed here.
- **Approval workflow**: this is Stage 2's conversion-approval design (`PRODUCT_STAGE2_SCHEMA_PLAN.md` §3) — same underlying mechanism, described from the Sales-experience side here rather than re-designed.
- **Version comparison**: proposals already version (migration 053's `version` column, already extensively used by this session's share-link work) — no side-by-side diff view exists yet; a real, well-scoped future feature.
- **Customer preview**: the existing public proposal page already IS the customer preview (same page a client eventually approves from) — the open question is whether Sales wants a *separate*, non-committing preview mode before actually sending, which doesn't exist today.
- **E-signature**: today's "signature" is a typed name + IP + content-hash (`approval_name`/`approval_ip`/`approval_content_hash`, traced extensively this session) — a real e-signature (drawn signature, third-party like DocuSign) would be a materially bigger feature, not a small extension.
- **View/activity tracking**: directly the share-link decision document's audit-log work (Part 9.4) — same mechanism, Sales-facing framing.
- **Mobile use**: standing, already-enforced requirement (per `HANDOFF.md`) — nothing sales-specific to design, just keep applying the existing discipline.
- **Automatic handoff without re-entry**: directly Stage 2's `project_handoff_records` snapshot mechanism (`PRODUCT_STAGE2_SCHEMA_PLAN.md` §4) — the whole point of that design is that PM never re-types anything Sales already captured.

## Usability risks (flagged, not resolved)

- Version comparison and optional packages are both real, unscoped gaps — building either without a dedicated design pass risks scope creep into the wrong shape.
- Conflating "Sales templates" (starting content) with "proposal boilerplate" (fixed legal text) in one settings screen would confuse who edits what and why — keep them visually and conceptually separate.
- A real e-signature feature is a materially different trust/liability surface than today's typed-name+IP+hash pattern — this needs its own explicit product decision (do you actually need DocuSign-equivalent legal weight, or is the current pattern sufficient for this business?) before any design work, not an assumed yes.

## Recommended representative prototype to build first

**Version comparison on an existing proposal** — narrow, high-value (directly serves the already-real "revision requested" flow this session did extensive replay-safety work on), and doesn't require Stage 2, Billing, or e-signature to exist first. A clean, self-contained next step once the authorization-bridge and share-link work currently in flight is settled.

## What this pass did not do

This is a lighter-depth document than the others produced overnight — it maps the flow against what already exists and flags real gaps, but does not wireframe screens, write user stories, or produce a full information architecture. That would be the natural next step once E confirms this is the direction worth investing further design time in.

---

## Task 9 Product Review (overnight autonomous pass, 2026-09-11)

**Verification status (added 2026-09-11, review; updated 2026-09-12): this entire section was produced by a delegated
background agent, not read and verified line-by-line by the orchestrating session.** The
orchestrating session independently spot-verified exactly ONE material current-state claim from
this section against source directly (the proposal table has no price column — confirmed in the
same component). Its formerly misleading "Pricing & Bill of Material" heading was corrected to
"Bill of Material" on 2026-09-12; the missing price data remains unchanged. No other claim below has
been independently re-checked by a second reader. Treat every **current-state ("current capability"
/ "missing capability" / "not found in code")** claim below as a **preliminary, agent-sourced
finding** that should be spot-checked again before being relied on for a real product decision —
not as a fully double-checked code audit. The **recommendations and proposed phased sequence**
remain valid product thinking regardless of whether every underlying citation is re-verified, since
they follow from the general shape of the findings, not from any single line number. The agent's own
stated methodology follows below, unedited.

**Method:** read-only. `PRODUCT_SALES_DISCOVERY.md` (312 lines) and this document were read in full
first; nothing below repeats their existing findings without re-verifying it against the current
code, since both docs predate three days of commits including migrations 127/128 (atomic quote→
project conversion, landed as commit `9e8ce64`). Every claim below is grounded in a direct read of
`src/main.tsx`, `src/persistence.ts`, or a migration file at the line numbers cited — current as of
this pass, not copied from the earlier discovery doc's (now slightly drifted) line numbers. Where a
capability was already correctly described in `PRODUCT_SALES_DISCOVERY.md`, this section says so
and cites the re-verified location rather than re-deriving it from scratch. "Proposals belong to
Sales" is treated as fixed and not revisited; the Submittal/PM handoff workflow is out of scope
beyond noting it exists downstream.

Standard: "not found in code" is stated explicitly wherever a plausible-sounding feature could not
be confirmed by grep/read — nothing below is inferred from what would make sense to build.

### Rapid quote creation

- **Current capability**: Single long detail page, not a multi-screen wizard. `handleCreateSalesQuote()` (`src/main.tsx:2943`) creates the quote from a "New Site" intake sheet; the same `SalesQuoteBuilder` detail view then holds Locations, "Pull Location Hardware into Quote BOM" (`main.tsx:22722-22726`, rolls up every location's camera/sign/sensor picks in one click), manual BOM-line add, and "Create & Send Proposal" (`main.tsx:22841-22848`) — all as sections on one scrollable page, no forced step-through.
- **Missing capability**: No quote template or "clone this quote" function anywhere — confirmed by grep for `quote_template`/`cloneQuote`/`duplicateQuote` (no hits) and for `handleCreateSalesQuote` call sites (only one, the blank-intake path). Every quote starts from a blank "New Site" sheet.
- **Resolved 2026-09-12**: Existing BOM lines now have Edit/Save/Cancel controls for item, quantity, notes, and catalog link. `updateSalesQuoteBomLine` validates the input, performs one checked PATCH, requires exactly one returned row, logs technical failure detail, and returns the saved row; the UI updates only after success and keeps the editor open after failure. Separately, a "start from a template" or "duplicate an existing quote" action would still remove the blank-page cost on every new deal — flagged as a real gap by both this pass and `PRODUCT_SALES_DISCOVERY.md` §3.1/§4.
- **Needs a product decision?**: No — both are scoped, additive UI/data changes with no process-order or approval implications.

### Reusable templates and content blocks

- **Current capability**: One shared, admin-editable set of boilerplate sections (`proposal_template_sections`, migration `053_sales_quote_proposals.sql:38-97`) applied to every proposal — fixed legal/scope text, not a rep-selectable starting point. Catalog items carry a free-text "bundle components" field (`SKU:qty, SKU:qty`, `main.tsx:19029`, `persistence.ts:2102/2215`) that is stored and displayed but — confirmed by grep — never explodes into actual BOM lines anywhere in `main.tsx` or `persistence.ts`. It is descriptive text a rep must read and manually re-enter as individual lines; nothing reads `bundle_components` and creates rows from it.
- **Missing capability**: No quote-level or job-level template (a starting BOM skeleton + expected locations), and no real "bundle" mechanism that inserts multiple structured, priced-and-catalog-linked lines from one action. Both were already correctly flagged as gaps in `PRODUCT_SALES_DISCOVERY.md` §1.1/§4 item 4 — re-confirmed here against current code, not changed since.
- **Usability friction**: The bundle field's presence in the catalog-item editor without any runtime effect is itself a trap — a rep who fills it in reasonably expects it to do something at quote-build time; it doesn't.
- **Suggested improvement**: Either wire `bundle_components` into a real "insert bundle" action on the BOM-line add row (parse the `SKU:qty` list, resolve each SKU against `catalog_items`, insert one BOM line per component), or remove the field's user-facing framing as a "bundle" until that exists, so it doesn't imply behavior it doesn't have.
- **Needs a product decision?**: Yes for job templates — whether templates are global or per-workspace, and who can create/edit one, is a scope call. No for the bundle-explosion fix — the field already exists and is unambiguous plumbing work.

### Polished client-facing presentation

- **Current capability**: `ProposalPublicPage` (`main.tsx:24760-24957`) — a single-scroll, tokenized, no-login page: header (site/client/city/quote ref), Executive Summary, a "Pricing & Bill of Material" table (thumbnail/item/description/qty/datasheet), boilerplate sections, and a response form. "Print / Save as PDF" (`main.tsx:24878`) via `window.print()` is the only PDF path — confirmed no PDF library in `package.json` (no `pdfkit`/`jspdf`/`puppeteer`/`pdf-lib`).
- **Missing capability**: A real, server-generated PDF independent of the browser's print dialog — not found in code. No document engagement analytics (open/view tracking) — not found.
- **Usability friction**: The section is literally titled **"Pricing & Bill of Material"** (`main.tsx:24913`) but the table has no price column and `buildProposalSnapshot()` (`main.tsx:4827-4855`) never includes a price field on any BOM line — the heading actively promises something the page does not deliver, which reads as a copy bug on top of the underlying pricing gap (see below). Every client-facing proposal today is spec/scope/photos only.
- **Suggested improvement**: Rename the section heading to "Bill of Material" (or similar) as an immediate, zero-risk copy fix independent of whether/when real pricing is built, so the page stops implying it shows a total it doesn't. Treat real PDF generation and pricing display as the two substantive gaps, already correctly identified as the single largest gap in `PRODUCT_SALES_DISCOVERY.md` §1.3/§5.
- **Needs a product decision?**: No for the heading fix. Yes for pricing display and PDF generation — both are substantial scope/investment calls already flagged in the discovery doc as needing E's direction.

### Drag/reorder behavior

- **Current capability**: `sales_quote_bom_lines.line_sort` exists as a column (migration `048_sales_quote_status_and_bom.sql:18`) but grep for `line_sort`/`lineSort` in `main.tsx` returns zero matches — the frontend never reads or writes it. No `draggable`, `onDragStart`/`onDrop`, `dnd-kit`, or `react-beautiful-dnd` usage anywhere tied to BOM lines or proposal template sections (the only genuine drag-and-drop hits in `main.tsx` are an unrelated file-upload dropzone at line 12487 and an explicit `draggable={false}` at line 20106). Proposal template sections order by a manually-typed `sequenceOrder` field.
- **Missing capability**: No drag/reorder UI for BOM lines or proposal sections — confirmed absent, not just unpolished.
- **Usability friction**: Reordering a proposal's sections today means editing a numeric "sequence order" value per section by hand, with no visual feedback of the resulting order until saved.
- **Suggested improvement**: A lightweight drag handle (a small library like `@dnd-kit/sortable`, already MIT and commonly used with React) on both the BOM-line list and the template-section list, writing back to `line_sort`/`sequenceOrder`. Low-risk, additive, no schema change needed for BOM lines (the column already exists and is unused).
- **Needs a product decision?**: No — pure UI/UX work, no process or authority implications.

### Product/catalog insertion into a quote

- **Current capability**: A BOM line is added via a plain text "Item name" input plus an optional `<select>` of every active catalog item (`main.tsx:22761-22769`) — confirmed no dedicated catalog-browsing modal, search box, or image-based picker exists (grep for "catalog picker"/"browse catalog"/"add from catalog" returns nothing). Location-level hardware (cameras, signs, sensors) does pull from a real catalog with images/datasheets (`sales_quote_location_items`, migration `056_location_hardware_lines.sql`), and "Pull Location Hardware into Quote BOM" promotes those into the quote BOM automatically.
- **Missing capability**: No searchable/filterable catalog picker for manually adding a BOM line — a rep scrolls a single flat `<select>` of every active catalog item with no search-as-you-type, category filter, or thumbnail preview inside the picker itself (the linked item's image only appears after selection, in the proposal preview).
- **Usability friction**: On a catalog with more than a handful of SKUs, a plain `<select>` becomes the friction point — no way to find an item by partial name or model number without scanning the whole list.
- **Suggested improvement**: Replace the flat `<select>` with a type-ahead/autocomplete combobox filtering `activeCatalogItems` by name/manufacturer/SKU as the rep types — a contained, non-schema-changing UI change.
- **Needs a product decision?**: No.

### Pricing accuracy

- **Current capability**: Cost/markup/sell-price fields exist only at the catalog level (migrations `046_catalog_pricing_and_specs.sql`, `013_product_catalog.sql`, `001_initial_ops_schema.sql`) — confirmed by grep for `unit_price`/`sell_price`/`markup_percent`/`margin` across all migrations. `sales_quotes.sales_quote_bom_lines` carries no price/cost/margin column at all (`048_sales_quote_status_and_bom.sql:12-20` — only `item_name`, `qty`, `notes`, `line_sort`). Dashboard KPIs (`main.tsx:18266-18308` area, re-verified present) compute profit/deal-size live against the catalog item's *current* cost/markup, so a later catalog price change silently rewrites a closed quote's historically reported profit — same finding as `PRODUCT_SALES_DISCOVERY.md` §1.4 point 5, re-confirmed against current code.
- **Missing capability**: No price is ever frozen per BOM line at quote time, and (per the section above) no price reaches the customer at all.
- **Usability friction**: There is genuinely no way today for a rep to make a *quote-time* pricing error, because there is no quote-time pricing input to get wrong — the risk is entirely on the reporting side (KPI drift after the fact), not data entry.
- **Suggested improvement**: Add `unit_price`/`unit_cost` snapshot columns to `sales_quote_bom_lines`, populated from the catalog item's current values at insert time and never recomputed afterward; recompute dashboard KPIs from those frozen values instead of live catalog joins.
- **Needs a product decision?**: Yes — this is the single highest-leverage and highest-stakes gap in the whole review (matches `PRODUCT_SALES_DISCOVERY.md`'s own ranking), and it touches pricing authority/margin visibility directly. E should decide whether/when to build this before any UI work starts.

### Optional/alternate line items

- **Current capability**: None. Grep for `optional`/`isOptional`/`alternate` against `sales_quote_bom_lines`'s schema and the BOM-line UI returns no matches tied to this concept.
- **Missing capability**: A customer cannot be offered a choice or a toggleable add-on anywhere in the current proposal flow — confirmed absent, not found in code.
- **Usability friction**: N/A — the capability doesn't exist to be clunky.
- **Suggested improvement**: Add an `is_optional` boolean to `sales_quote_bom_lines`, surfaced as a checkbox on the customer-facing table with live subtotal recomputation — but this only matters once pricing exists (above), since an "optional" line with no visible price has nothing meaningful for the customer to accept or decline.
- **Needs a product decision?**: Yes — sequenced behind the pricing decision above; raising it separately risks scope creep into the wrong shape, per this document's own existing risk note.

### Internal approval before sending

- **Current capability**: `handleCreateQuoteProposal()` (`main.tsx:4866-4881`+) creates and emails the proposal in one step, gated only by `["sales", "pm", "manager"]` role membership (`api/send-proposal-email.js:37`) — a role check, not a peer-review/approval step. The only real approve/review/approve pattern in the codebase is Catalog Price Change Requests (`main.tsx:17787`, "Sales reps have no direct write access to the catalog -- their cost/markup/price edits land here for approval") — a different workflow, for catalog changes, not for sending a proposal.
- **Missing capability**: No manager sign-off gate before a proposal reaches a customer — confirmed absent by grep for `approval_threshold`/`requires_approval`/`internal_approval` (zero hits tied to proposals).
- **Usability friction**: N/A — nothing to be clunky, it simply doesn't exist.
- **Suggested improvement**: Reuse the existing Catalog Price Change Requests propose/review/approve pattern (already built, already understood by the team) as the template for a proposal-send approval gate, rather than designing a new mechanism from scratch.
- **Needs a product decision?**: Yes — explicitly flagged, this is a process-order and authority question (who approves, at what deal size/threshold, or at all) that only E should decide.

### Version history

- **Current capability**: Each "Create & Send Proposal" creates a new, frozen, incrementing version (`nextVersion` logic, `main.tsx:4876-4877`); the per-quote proposal list (`main.tsx:22854-22885`) shows every version's status, sent/responded dates, response notes, and its own "Copy client link" — so past versions remain individually viewable and their outcomes are visible side by side in the rep's own view.
- **Missing capability**: No diff/redline view between two versions' content — confirmed absent, matching `PRODUCT_SALES_DISCOVERY.md`'s existing finding, re-verified against the current version-list rendering (it shows metadata per version, never a content comparison).
- **Usability friction**: A rep who wants to know *what actually changed* between v1 and v2 of a proposal has to open both versions' share links and eyeball them side by side — there's no in-app shortcut.
- **Suggested improvement**: Matches this document's own existing recommendation (see "Recommended representative prototype to build first" above) — a version-comparison view remains the right narrowly-scoped next Sales feature, and nothing found in this pass changes that recommendation.
- **Needs a product decision?**: No — self-contained feature, no approval/authority/process-order implications.

### Client comments/questions on a proposal

- **Current capability**: More than the discovery doc's framing suggested on a literal reread — the response form (`main.tsx:24946`, "Notes (optional)" textarea) captures free-text client input alongside Approve/Request Revision/Reject, stored as `responseNotes` and shown to the rep in the version list (`main.tsx:22868`, rendered as a quoted note). This is a real, if narrow, interaction channel.
- **Missing capability**: It is one-shot and one-directional — the client can leave a note only at the moment they respond (approve/reject/request revision), and there is no threaded exchange, no way for the rep to reply inside the same surface, and no way for the client to ask a question mid-review without triggering a status change.
- **Usability friction**: A client who wants to ask a clarifying question before deciding has no way to do so without picking one of the three terminal actions — "Request Revision" is the closest fit but forces a status change just to leave a comment.
- **Suggested improvement**: A lightweight, non-status-changing "Ask a question" action on the public page that posts into the existing `channels`/`conversations` per-client messaging system (confirmed real in `PRODUCT_SALES_DISCOVERY.md` §1.2, not re-traced line-by-line in this pass) rather than building a new comment system from scratch.
- **Needs a product decision?**: Yes — connecting an unauthenticated public page to an internal messaging channel raises access/notification questions worth E's sign-off before building.

### E-signature or equivalent acceptance mechanism

- **Current capability**: Typed name + captured IP + SHA-256 content hash, computed in `respond_to_quote_proposal()` (migration `053_sales_quote_proposals.sql:198-199`, columns at `:113-116`) — confirmed unchanged from the discovery doc's description; this pass re-verified the RPC and columns still match.
- **Missing capability**: No drawn/certificate-based signature, no signer-identity verification loop (e.g., email confirmation back to the named signer), no multi-party/countersignature routing — not found in code.
- **Usability friction**: None inherent — the mechanism works as designed for an internal tool with already-trusted counterparties, per this document's own existing risk note.
- **Suggested improvement**: No change recommended without a prior decision (see next line) — building toward DocuSign-equivalent legal weight is a materially different feature, not a small extension, as this document already states.
- **Needs a product decision?**: Yes — already flagged in this document's existing "Usability risks" section as needing an explicit yes/no from E before any design work; this pass found nothing that changes that framing.

### Mobile presentation (customer-facing proposal page specifically)

- **Current capability**: The proposal BOM table carries `className="proposal-bom-table stack-table-mobile"` (`main.tsx:24914`), and `.stack-table-mobile` has a real `@media (max-width: 760px)` rule (`src/styles.css:7038-7094`) that hides the header row and stacks each row as its own bordered block — genuine, verified mobile handling, not assumed.
- **Missing capability**: None structurally — the table does reflow on a phone-width viewport.
- **Usability friction**: `.stack-table-mobile`'s per-field labels only render when a `<td>` carries a `data-label` attribute (`styles.css:7087-7094`, confirmed by reading the CSS comment at `7026-7037`: tables "without a bespoke mobile-card component" get generic stacking, "no custom field labels/icons"). The proposal table's `<td>` elements (`main.tsx:24918-24925`) carry no `data-label` attributes — on a phone, each stacked row shows its thumbnail, item name, description, qty, and datasheet link with no field labels distinguishing them, which is markedly less legible than the desktop table with column headers.
- **Suggested improvement**: Add `data-label="Item"`, `data-label="Description"`, etc. to each `<td>` in the proposal table (a small, contained JSX change) so the existing CSS's label-rendering path (already built for this exact case) actually activates on this specific table.
- **Needs a product decision?**: No — small, contained fix with an existing CSS mechanism already built for exactly this.

### Brand customization

- **Current capability**: `company_branding` (companyName, logo) exists and is real — `loadCompanyBranding`/`saveCompanyBranding`/`uploadCompanyLogo` (`main.tsx:309-322`), rendered in the internal app's own header (`main.tsx:6801-6803`, `brand-mark`/`brand-title`). Confirmed by grep: zero references to `company_branding`, logo, or brand color anywhere inside `ProposalPublicPage` (`main.tsx:24760-24957`) or its surrounding render path.
- **Missing capability**: The customer-facing proposal page shows no company logo, no accent color, and no branding at all — it is not wired to `company_branding` in any way. This is a stronger gap than the earlier discovery pass's framing ("already partially real... extend to control the proposal page") suggested — as of this pass, the connection to the public page does not exist yet, not just needs extending.
- **Usability friction**: A client-facing document with zero branding reads as unfinished/generic regardless of how good the underlying content is — this is a visible, first-impression gap, not a back-office one.
- **Suggested improvement**: Render `branding.companyName`/`companyLogoUrl(branding.logoStoragePath)` in the `ProposalPublicPage` header, workspace-scoped once that scoping lands (per this document's own existing note tying this to Stage 9's onboarding plan) — the branding data and upload UI already exist; only the public page's render path needs the wire-up.
- **Needs a product decision?**: No for wiring in the existing company name/logo — additive, no ambiguity. Yes only if E wants per-deal or per-template color themes beyond the single workspace-wide logo/name that exists today.

### Conversion into Billing and Projects without re-entry — verified strength

- **Current capability**: Confirmed atomic and idempotent, as migrations 127/128 intended. `create_project_from_quote(p_quote_id)` (`backend/supabase/migrations/127_atomic_project_conversion.sql:232-441`) runs the project row, scope-of-work row, every BOM line, every location (with camera/sign/sensor/misc/VPU items, address, and accessory fields), and a tamper-resistant `project_conversion_receipts` row all inside one Postgres function — one implicit transaction, so a mid-conversion failure leaves nothing partially written. Idempotency is enforced at the database level via a unique index on `projects.source_sales_quote_id` (migration `127`:172-174) plus a unique-violation branch (`127`:341-350) that returns the existing project instead of duplicating one on a retry. The one piece that can't live inside that SQL transaction — copying photo storage objects — is handled client-side in `createProjectFromClosedWonQuote()` (`persistence.ts:10529-10664`) with per-photo retry-safety: a `source_quote_image_id` unique index (migration `127`:184-186) lets a retry skip photos already copied, a 409 conflict is treated as "already copied" rather than a false failure (`persistence.ts:10594-10614`), and an orphaned storage object is cleaned up if its database row can't be saved (`persistence.ts:10607`, `10623`). Migration `128_harden_project_insert_trigger_chain.sql` hardens the trigger chain this function depends on. This is a genuinely mature, well-engineered piece of the product — describe it as a strength, not a gap, per the task brief.
- **Missing capability**: `client_id` is still not carried onto the created project — confirmed by reading the full `insert into public.projects (...)` column list in `127`:329-339, which has no `client_id` column at all, same gap `PRODUCT_SALES_DISCOVERY.md` §1.4 point 1 already identified (now inside the new atomic function rather than the old client-side code, but not fixed by the rewrite). The quote's own `quote_ref` is also not stamped onto the created project (no `quote_ref`/`source_quote_ref` column in the same insert list).
- **Usability friction**: None in the conversion mechanism itself — the friction is entirely the pre-existing `client_id`/`quote_ref` gap carried forward unchanged.
- **Suggested improvement**: Since `client_id` already exists as a nullable column on both `sales_quotes` and `projects` (per `PRODUCT_SALES_DISCOVERY.md` §1.1), add it to `create_project_from_quote()`'s insert list as a one-line, low-risk addition to an already-hardened function — the atomicity work already done makes this a safe follow-up, not a reason to reopen the whole migration.
- **Needs a product decision?**: No — this is a small, scoped data-completeness fix to a mechanism whose behavior and authorization model are already decided and shipped.

### Recommended phased sequence

Given a small team competing against two dedicated, mature products rather than trying to out-build
either of them feature-for-feature, three closes matter most, in this order:

1. **Frozen per-line pricing on `sales_quote_bom_lines`, feeding the customer-facing proposal.** This is the one gap that determines whether Ergon can replace PandaDoc at all for its core job — quoting a customer a price — rather than being a nice-to-have. Every other Sales gap (optional line items, approval-before-send, PDF polish) is either downstream of this or meaningfully less valuable without it. This also directly fixes the silent margin-drift bug in the dashboard KPIs as a side effect of freezing the values at quote time.
2. **In-place BOM-line editing and the `client_id`/`quote_ref` carry-through fix.** Both are small, low-risk, already-scoped changes (no new schema design, no process decision) that remove real day-to-day friction and complete work that's already 95% done (the atomic-conversion migration, the catalog-link editing pattern) rather than opening new scope. High value per unit of effort, and neither competes for the same design attention as item 1.
3. **Internal approval-before-send gate**, reusing the already-built Catalog Price Change Requests pattern. Once real pricing exists (item 1), a proposal carrying a wrong price becomes a much higher-stakes mistake than today's price-free document — this gate becomes materially more important right after item 1 lands, not before. Sequencing it third (not first) avoids building an approval workflow for a document that currently has nothing price-related to approve.

Deliberately **not** prioritized here, consistent with this document's and `PRODUCT_SALES_DISCOVERY.md`'s existing "later, HubSpot-level" framing: drag/reorder polish, a searchable catalog picker, branded theme wiring, and version-diff view are all real and worth doing, but none of them gate whether Ergon can functionally stand in for PandaDoc/HubSpot the way pricing does — they are quality-of-life improvements on a foundation, not the foundation itself.
