# Ergon Product Start Plan

Status: Initial working plan; discussion required before process changes  
Created: 2026-09-07  

## Purpose

This document explains how to begin moving toward the product direction in `PRODUCT_PLAN.md` while preserving useful work already in Ergon. It starts with evidence, workflow mapping, and prototypes. It does not authorize automatic replacement of existing business processes.

## Starting principles

1. Reuse working capabilities and data wherever practical.
2. Understand the current real-world process before changing it.
3. Start with one representative workflow and complete it end to end.
4. Separate technical completion from production verification and user acceptance.
5. Prototype substantial workflow changes before broad programming.
6. Test with the people who perform the work.
7. Capture decisions and unresolved questions in writing.
8. Keep desktop and mobile use in scope from the beginning.
9. Treat product readiness and company configurability as requirements for all new or redesigned work.
10. Do not onboard a second company until tenant isolation has been designed, implemented, and independently verified.

## Productization baseline before expansion

Before substantial new modules are added, document where Ergon still assumes one business. Review the database, server routes, storage, scheduled jobs, notifications, search, caches, exports, logs, and administrative screens for company/workspace ownership.

The baseline should identify:

- Records with no workspace or tenant identity.
- Singleton company settings and default-workspace assumptions.
- Database policies that allow broader access than the future product model permits.
- Server routes that do not resolve and enforce the caller's workspace.
- Files, search results, messages, notifications, and reports that could cross workspace boundaries.
- Hard-coded business names, contact information, branding, roles, statuses, templates, wording, or email content.
- Settings that already have safe administrator controls.
- Settings that require a new configurable interface.
- Configuration changes that need versioning, preview, audit, or rollback.

This audit should result in a staged productization plan. Do not mechanically add a workspace column everywhere without first defining the workspace, membership, role, provisioning, and data-migration model.

## Step 1: Establish the current-state map

Create an honest inventory of what exists today, what is partial, and what still happens outside Ergon.

For each lifecycle stage, record:

- People and roles involved.
- Existing Ergon screens and records.
- External tools currently used.
- Information entered or copied.
- Approvals and control points.
- Outputs and downstream handoffs.
- Common exceptions and failure points.
- Areas that users avoid or work around.
- Current reports and measures of success.

The inventory should classify each capability as:

- Working and accepted.
- Working but difficult to use.
- Partial or placeholder.
- Built but not verified in real use.
- Missing.
- Intentionally deferred.

Initial evidence already indicates that Marketing, Sales/Site Builder, Purchasing, Inventory, Projects, Client Ledger, SaaS tracking, Tasks, communications, notifications, and reporting have foundations. The map must verify their actual present behavior rather than relying on feature names.

Also inventory the configuration that already exists: company branding, roles and tab access, product catalog, proposal content, schedule templates, notification rules, and intake/form controls. Record which changes still require code and which are already safe for a company administrator.

## Step 1A: Design the new-company onboarding journey

Alongside the operating workflow map, prototype the experience of a completely new customer company:

1. Workspace is provisioned.
2. The first company administrator signs in.
3. Company identity and branding are entered.
4. Modules, roles, and responsibilities are selected.
5. Products, clients, and templates are imported or created.
6. A sample quote-to-project workflow is completed.
7. Readiness checks identify missing setup.
8. The workspace is launched to invited users.

The onboarding prototype should show sensible defaults, progress, explanations, previews, and safe ways to revise setup later. Product subscription plans and payment collection are not part of this phase.

## Step 2: Map one real sale from beginning to project creation

Use one common, representative sale. Avoid beginning with the rarest or most complicated exception.

Document the current journey through HubSpot, PandaDoc, Billing, and project setup:

1. Lead or customer is created.
2. Opportunity is qualified.
3. Site and solution information is collected.
4. Products, labor, recurring services, and pricing are calculated.
5. Internal review occurs.
6. Proposal is assembled and presented.
7. Customer changes are managed.
8. Customer signs.
9. Billing reviews the agreement.
10. Down payment is requested and received.
11. Project release is approved.
12. Project information is created or transferred.

For every step, identify duplicate entry, delays, missing information, workarounds, and who decides that the work may advance.

## Step 3: Define the minimum Sales replacement

The first Sales release should be judged against the actual HubSpot-plus-PandaDoc workflow. It should include the daily capabilities required for adoption, not every possible CRM or document-editor feature.

The initial scope should be proposed from the current-state map and then approved. Likely areas include:

- Client, contact, site, and opportunity records.
- A usable opportunity pipeline.
- Activities, notes, follow-ups, ownership, and reminders.
- Guided quote creation from saved templates and product bundles.
- Accurate one-time and recurring pricing.
- Margin and approval controls.
- Reusable scope, warranty, exclusions, and terms content.
- Polished web and PDF presentation.
- Internal review, customer acceptance, and signature.
- Billing Review and deposit handoff.
- Approved conversion into a project without re-entry.

## Step 4: Design before broad implementation

Produce a clickable prototype for the representative sale. It should cover:

- Opportunity overview.
- Guided quote builder.
- Customer proposal preview on desktop and mobile.
- Internal approval state.
- Customer acceptance state.
- Billing Review queue.
- Deposit status.
- Project-release approval.
- The resulting project record.

The proposal experience should be tested as both a salesperson and a customer. The internal builder and customer presentation are related but different interfaces.

## Step 5: Validate with users

Test the prototype with actual users before committing to a broad rebuild. At minimum, observe whether a salesperson can:

- Find the correct customer and opportunity.
- Build a normal quote without outside instructions.
- Understand required and optional information.
- Make an approved pricing change.
- Preview exactly what the customer will receive.
- Send or revise the proposal confidently.
- Understand what happens after signature.

Also validate the receiving handoff with Billing and Projects. A faster Sales experience is not successful if it sends incomplete or ambiguous work downstream.

Capture confusion, incorrect assumptions, unnecessary clicks, missing exceptions, and requested shortcuts. Discuss any proposed process change before adopting it.

## Step 6: Build in controlled vertical slices

After approval, implement one complete working path at a time. A suggested sequence is:

### Slice A: Shared customer foundation

Establish the workspace, membership, and tenant-isolation foundation together with reliable Client, Contact, Site, Opportunity, and ownership relationships. Reconcile existing repeated client text carefully; do not guess at mergers.

### Slice B: Structured quote and presentation

Create the template, content, bundle, pricing, preview, version, approval, and signature path for the representative sale.

### Slice C: Commercial handoff

Implement Signed Quote -> Billing Review -> Deposit -> Project Approval with visible ownership, requirements, and failure handling.

### Slice D: Project creation

Transfer accepted scope, contacts, sites, locations, products, documents, dates, images, and commercial allowances into the project. Preserve the signed quote as an immutable version.

### Slice E: Closeout readiness

Define the information that a project must produce for installed assets, warranty, SaaS, and future Support. Begin collecting it at the correct point instead of waiting until closeout.

## Step 7: Prepare future Engineering and Support boundaries

Do not build full Engineering or Support modules in the first Sales effort. Do ensure new records can later support:

- Requirements and technical revisions.
- Drawings and approval versions.
- Proposed, sold, approved, and installed configurations.
- Installed assets and serial numbers.
- Warranty and commissioning dates.
- SaaS subscriptions and service entitlements.
- Support cases and maintenance history.

Any early field added solely for a future module should have a clear owner and purpose. Avoid speculative fields that no current or planned workflow will populate.

## Step 8: Add operational visibility

Run a read-only observability audit across the application. Classify error handling and background activity as:

- Expected fallback with no action required.
- User-visible failure requiring a clear message.
- Operational event requiring System Health history.
- Repeated or critical condition requiring an administrator alert.
- Technical diagnostic only.

Prioritize failed saves, misleading empty states, notification or delivery failures, scheduled jobs, offline uploads, payment and signature events, handoff failures, and infrastructure fallbacks. Describe each in real-world language and state whether information was saved, sent, charged, or changed.

## Initial decisions to document

The discovery and prototype work should produce written decisions for:

- Which HubSpot capabilities Sales considers essential.
- What users dislike about the current PandaDoc and Ergon experiences.
- Which quote types represent most normal sales.
- Who can change price, margin, terms, templates, and approved content.
- Required Billing Review checks.
- What counts as down payment received or approved.
- Who authorizes project release.
- Which Engineering activities may begin before financial release.
- What information must transfer into a project.
- What must be captured for closeout and future Support.
- Which customer-facing presentation styles should be prototyped.
- Which settings a company administrator may change without platform support.
- Which workflow controls must remain protected or require approval.
- What the default workspace, roles, modules, templates, and sample data contain.
- How existing single-company records will be assigned and migrated safely.
- What evidence is required before the first outside company is onboarded.

## Measures of success

Baseline the current workflow before claiming improvement. Suggested measures include:

- Time to create a normal quote.
- Number of systems opened per opportunity.
- Number of fields or documents re-entered.
- Quote correction and approval cycles.
- Time from signature to Billing Review.
- Time from deposit to project release.
- Missing-information returns from Billing or Projects.
- Salesperson completion rate without assistance.
- Customer proposal engagement and acceptance rate.
- User-reported confidence and ease of use.
- Time for a new company administrator to complete initial setup.
- Percentage of routine configuration completed without a programmer.
- Number of hard-coded company-specific changes required for launch, with a target of zero.
- Verified absence of cross-workspace data access in database, API, file, search, notification, and reporting tests.

## First deliverables

1. Current-state capability, configuration, and workflow map.
2. ~~Productization and tenant-isolation gap audit.~~ **Delivered 2026-09-08 — see `PRODUCT_TENANCY_AUDIT.md`.** Read-only; no production code, database policy, migration, workflow, or business process was changed to produce it. Covers every requested area (singleton/hard-coded-company assumptions, which records have explicit workspace ownership, RLS/API/Storage/search/notification/scheduled-job/cache/export/reporting boundaries, cross-company exposure mechanisms, existing no-code controls, configuration still requiring programming, configuration needing versioning/audit/approval, a proposed tenant/workspace architecture preserving Ergon as the first workspace, a staged migration approach, and open questions for owner discussion). Headline finding: zero tables in the current schema have any company/workspace/tenant column, and the dominant RLS pattern is fully open to any signed-in user — expected and reasonable for a single-company tool, but the confirmed baseline this whole plan's tenant-isolation requirement (principle #10 above) is measured against. **Update, same day**: E set working defaults for all twelve of the audit's open questions (`PRODUCT_TENANCY_AUDIT.md` §10); two previously-open verification items (does editing a Proposal/Schedule Template retroactively change historical records?) are now directly confirmed safe by code trace; the exact current admin roster was confirmed (one account); and `PRODUCT_PHASE1_PLAN.md` now carries a concrete, not-yet-implemented plan for the first (fully additive) tenancy phase — workspaces/workspace_members/platform_admins tables, migration of existing data into the first workspace, rollback, and a production verification checklist. Still pending: E's review and go-ahead before any of it is implemented.
3. Clickable new-company onboarding and configuration prototype.
4. Read-only application visibility and logging audit.
5. One real HubSpot -> PandaDoc -> Billing -> Project journey map.
6. Approved requirements for the minimum Sales replacement.
7. Clickable Sales-to-Project prototype, including customer presentation.
8. User-test findings and approved revisions.
9. Technical implementation plan divided into controlled vertical slices.

No broad workflow replacement should begin until the relevant current-state map, proposed change, and affected-user review are complete.
