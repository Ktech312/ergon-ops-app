# Ergon Product Plan

Status: Approved strategic direction; living plan  
Created: 2026-09-07  
Owner: Ergon leadership  

This document defines what Ergon is intended to become. It is the product-level source of truth for roadmap decisions and, later, the foundation for marketing language. `HANDOFF.md` remains the source of truth for current implementation, migrations, verification, and open technical work.

## Product definition

Ergon is an end-to-end business operations platform that carries a customer from marketing through sales, engineering, billing, project delivery, closeout, and ongoing service without repeatedly entering or transferring the same information.

The intended lifecycle is:

**Marketing -> Lead / CRM -> Sales -> Quote / Contract -> Billing Review -> Engineering / Development -> Project Delivery -> Closeout -> Service / Support -> Renewal / Expansion**

Ergon should help each team do its own work while preserving one continuous customer, site, commercial, technical, and operational history.

## Product promise

Ergon should:

- Keep customer and job information in one connected system.
- Let each department receive a complete, structured handoff from the previous department.
- Eliminate avoidable re-entry of contacts, scope, equipment, pricing, documents, and project information.
- Show who owns the next action and what is blocking progress.
- Make failures visible in plain language, with their business impact and a useful next step.
- Work well on desktop and mobile for office and field users.
- Preserve an auditable history from first contact through the installed system and its ongoing support.

## Product from the beginning

Ergon began as an application for one operating business, but all new product decisions should treat it as a sellable product that another company can set up and operate without routine code changes.

Product-ready is a requirement alongside mobile-ready. Every new or redesigned capability should be evaluated for:

- A new company's setup and first-use experience.
- Secure separation between companies and their information.
- Administrator-controlled configuration.
- Useful defaults that can be changed without programming.
- Clear permissions, audit history, and recovery from configuration mistakes.
- Desktop and mobile usability.
- Upgrade and migration behavior for existing customers.

Existing single-company assumptions should be identified and retired deliberately as affected areas are developed. This requirement does not authorize a risky, all-at-once database conversion.

### Company and workspace separation

Each customer company should have its own durable workspace or tenant identity. Users, clients, contacts, quotes, projects, files, templates, messages, settings, billing operations, installed assets, and support information must belong to the correct workspace and be protected at the database and server levels.

A company administrator should be able to manage its workspace without gaining access to another company's information. Platform administration, company administration, managers, and operating roles should remain distinct concepts.

Current branding and workspace-key foundations are partial starting points, not proof that the application is fully multi-tenant. Productization requires a specific architecture and security review before a second company is onboarded.

### Guided setup and onboarding

A new company should be able to move through a guided setup that includes:

1. Create the company workspace.
2. Enter company identity, addresses, contact information, timezone, and regional settings.
3. Add branding, logo, colors, document identity, and customer-facing contact details.
4. Invite team members and assign responsibilities.
5. Choose enabled modules and navigation.
6. Review or modify workflow stages, statuses, approvals, and required fields.
7. Import or create clients, contacts, products, services, pricing, and equipment bundles.
8. Select and customize quote, email, document, project, and schedule templates.
9. Configure notifications, business hours, and escalation rules.
10. Run a sample workflow and complete a launch checklist.

Onboarding should support saving progress, returning later, previewing customer-facing output, and clearly showing what remains incomplete.

### No-code business configuration

Authorized company administrators should be able to manage routine business configuration without a programmer. Appropriate configurable areas include:

- Company name, logo, contact details, colors, and document branding.
- Team members, roles, module access, and routine permission assignments.
- Products, services, bundles, costs, prices, recurring charges, and catalog tags.
- Quote and proposal templates, reusable sections, terms, warranties, and exclusions.
- Intake forms, custom fields, required fields, and controlled choices.
- Project and schedule templates.
- Workflow stages, approval thresholds, and responsibility assignments where safe.
- Notification rules and escalation preferences.
- Document categories, numbering conventions, and customer-facing email templates.
- Regional formats, tax-related configuration, business hours, and timezones.

Configuration should use guardrails. Changes should be previewable, versioned where they affect customer or operational output, audited, and reversible when practical. Published templates should not silently rewrite previously signed quotes, approved projects, or historical records.

Configuration and custom software are different. A company administrator may change approved settings and templates; changes to security boundaries, financial controls, core record relationships, or unsupported workflow behavior still require product review and deliberate development.

### Product account billing intentionally deferred

Ergon does not need a product-subscription billing section yet. Plans, trials, credit cards, customer subscription checkout, invoices for using Ergon, seat billing, and automated account suspension are deferred.

This is separate from the operational Billing stage inside a customer's workflow. Quote deposits, project invoices, Client Ledger activity, SaaS services sold by that customer, and Billing Review remain part of the operating product plan.

## Lifecycle modules

### Marketing

Purpose: generate and understand demand.

Long-term capabilities include campaigns, inquiries, lead sources, attribution, reusable project media, customer segments, and conversion reporting. The existing Marketing project-photo library is an early foundation.

### Lead and customer management

Purpose: give Sales one usable view of the relationship.

Long-term capabilities include companies, contacts, sites, lead qualification, ownership, activity history, calls, emails, meetings, notes, follow-up tasks, reminders, duplicate protection, and a visual opportunity pipeline.

The durable customer record must eventually replace repeated client-name text with a real shared client identity. A client may have many sites, contacts, opportunities, quotes, projects, installed assets, subscriptions, invoices, and support cases.

### Sales and quoting

Purpose: let a salesperson move from opportunity to an accurate, polished, accepted proposal without moving between HubSpot and PandaDoc.

The target experience combines:

- CRM and pipeline tools people rely on in HubSpot.
- Structured products, packages, pricing, margins, and approvals.
- A customer presentation that is easier to produce and visually stronger than the current PandaDoc workflow.
- Electronic acceptance, signatures, and down-payment initiation.
- A complete handoff into Billing and Projects.

Salespeople should not have to design a document from a blank page. They should choose a job template, complete guided information, select products and options, and receive a professionally formatted web proposal and PDF automatically.

The quote system should separate:

- Customer, site, and opportunity data.
- Product bundles and quantities.
- One-time, recurring, labor, shipping, tax, discount, and margin rules.
- Reusable scope, exclusions, warranty, and terms content.
- Visual presentation themes and section order.
- Internal approvals and customer-facing versions.

### Billing and commercial review

Purpose: validate the commercial agreement and control financial release.

When a quote is signed, Ergon should lock the accepted version and automatically send it to Billing Review. Billing should verify customer details, tax, pricing, payment terms, deposit requirements, and any exceptions. Once the required down payment is received or approved, the work becomes eligible for project release.

The existing Client Ledger and SaaS billing foundations should grow into a single view of deposits, project invoices, recurring subscriptions, service charges, credits, and outstanding balances.

### Engineering / Development

Purpose: turn the sold solution into an approved technical release.

This module is future scope, but current architecture must preserve the information it will need:

- Customer and site requirements.
- Sold scope, assumptions, and exclusions.
- Product configurations and location relationships.
- Drawings, submittals, specifications, and document versions.
- Technical questions, revisions, reviews, and approvals.
- Clear proposed, sold, approved, and installed states.
- Release packages for Purchasing, Production, and Project teams.

Engineering may occur before or after Billing release depending on the job. The workflow must support controlled parallel work and gates rather than assuming every project follows one rigid sequence.

### Project delivery

Purpose: deliver the approved work with control over scope, materials, schedule, labor, cost, communication, and changes.

Project creation should use the accepted quote and approved technical information. It should carry over customer and site information, contacts, scope, locations, equipment, documents, dates, commercial allowances, images, and assigned staff. The project team should not rebuild the sale manually.

Existing Projects, Purchasing, Inventory, Tasks, Shipping, documents, locations, channels, and reporting are substantial foundations for this stage.

### Project closeout

Purpose: confirm completion and turn delivered work into a reliable customer record.

Closeout should collect completion approval, final billing status, as-built documentation, training records, warranties, serial numbers, commissioning dates, open deficiencies, customer acceptance, and final project documents.

Closing a project must create or update the installed-system and support profile. Closeout data should not remain buried only in a PDF or project folder.

### Service / Support

Purpose: support what was installed and maintain the long-term customer relationship.

This module is future scope, but the data foundation should begin during quoting, engineering, installation, and closeout. The support profile should eventually include:

- Installed products, quantities, configurations, and physical locations.
- Serial numbers and installation or commissioning dates.
- Warranty start and expiration dates.
- Manuals, drawings, photos, credentials references, and training records.
- Customer contacts, sites, service entitlements, and response commitments.
- SaaS subscriptions, renewal dates, and billing standing.
- Maintenance schedules and open deficiencies.
- Tickets, communications, repairs, replacements, and recurring issues.

The Client Ledger, installed-assets work, SaaS tracking, project channels, and project history are early foundations. Support should be able to understand what the customer owns, what coverage applies, and the complete history without reconstructing the project.

### Renewal and expansion

Purpose: turn service knowledge into responsible follow-up and future work.

Renewals, equipment lifecycle events, recurring issues, expiring warranties, subscription dates, and expansion requests should be able to create Sales opportunities while preserving their support and project context.

## Shared records that connect the lifecycle

The following should become shared platform records rather than department-specific copies:

1. Client
2. Contact
3. Site
4. Opportunity
5. Quote and accepted quote version
6. Product, service, and equipment catalog
7. Location and system design
8. Billing account and Client Ledger
9. Project
10. Installed asset
11. SaaS subscription or service entitlement
12. Document and document version
13. Task, approval, and responsibility
14. Communication and activity timeline
15. Support case

Each record should have a stable identity, an owner, timestamps, permissions, status history, and links to the related records that came before and after it.

Every shared record must also have an explicit workspace owner before Ergon is offered to another company. Workspace scoping cannot depend only on what the user interface chooses to display.

## Required handoffs and gates

Every lifecycle transition should state:

- What triggers it.
- What information is required.
- Who reviews or approves it.
- What happens automatically.
- What remains editable afterward.
- What is locked as historical evidence.
- What happens if the transition fails.

The first priority handoff is:

**Signed Quote -> Billing Review -> Down Payment -> Project Approval -> Project Created**

An accepted quote should remain an immutable commercial snapshot. Corrections after acceptance should use a documented revision, change order, or approval rather than silently changing the signed record.

## User experience principles

- Organize work around the user's next decision, not the database structure.
- Show a concise summary first and details on demand.
- Use guided workflows for infrequent or complex tasks.
- Reuse saved customer, product, content, and project information.
- Make the current status, owner, blocker, and next action obvious.
- Let users preview customer-facing material as the customer will see it.
- Provide strong defaults while allowing authorized exceptions.
- Design mobile behavior as part of each feature.
- Use plain business language for messages and errors.
- Preserve drafts and explain whether an action saved, sent, charged, or changed anything.
- Avoid duplicate alerts and avoid making administrators monitor routine noise.

## Visibility and system health

Ergon should have a unified System Health and Activity capability. Operational events should explain:

- What happened.
- Who or what was affected.
- Whether information was saved, sent, charged, or changed.
- Whether the system recovered automatically.
- What a person should do next.
- When the process last succeeded.
- A technical reference for investigation.

User-correctable failures belong near the action. Repeated delivery failures, failed writes, missed scheduled jobs, persistent infrastructure failures, suspicious rate limiting, or schema mismatches should also appear for administrators. Routine successful activity belongs in history and reporting rather than interruptive alerts.

## Process protection and decision rule

Existing business processes must not be replaced, reordered, or automated merely because a different approach appears more efficient.

Before changing a process:

1. Document the current real-world process and why it exists.
2. Identify the users, exceptions, approvals, and downstream effects.
3. Show the proposed workflow and its tradeoffs.
4. Discuss it with Ergon leadership and the affected users.
5. Record the decision.
6. Prototype and test the change before broad implementation when the change is substantial.

Small usability improvements that do not alter responsibility, approvals, financial control, data ownership, or operational sequence may proceed under the normal implementation rules. Any change that does affect those things requires discussion first.

## Current foundations

The application already contains meaningful portions of the plan. Current implementation truth remains in `HANDOFF.md`, but known foundations include:

- Marketing access to project photography and searchable installation highlights.
- Sales, Site Builder, quotes, product catalog, locations, BOM, scope, images, and quote-to-project transfer work.
- Purchasing, receiving, vendors, inventory, allocation, builds, shipping, and project transfers.
- Projects, tasks, documents, locations, stakeholders, submittals, closeout-related records, SaaS placeholders, and reporting.
- Client Ledger and installed-assets foundations.
- Direct messages, project/section/client channels, mentions, notifications, and search.
- Roles, audit and deletion history, mobile patterns, and trusted notification delivery.
- Company name/logo administration, editable proposal content, schedule templates, forms, catalog configuration, role access, and notification rules provide a partial no-code foundation.

These foundations should be assessed and reused. A new plan does not authorize rebuilding working areas from scratch. Several were originally designed around a singleton company or default workspace and require a productization audit before they can support multiple customer companies safely.

## Marketing foundation

Future marketing material may use this plan to explain Ergon as one connected operating system from first customer interest through ongoing support. Public claims must reflect capabilities that are actually shipped and verified. Future modules should be described as roadmap direction until they exist.

Potential message themes include:

- Enter information once and carry it through the entire customer lifecycle.
- Turn an accepted sale into a controlled billing and project handoff.
- Connect customer history, field execution, installed assets, subscriptions, and service.
- Give every team the context it needs without switching between disconnected systems.
- Configure the workspace around the company's people, templates, products, and processes without routine programming.

Final positioning, feature claims, audience language, and proof points will be developed separately when the relevant workflow has been implemented and tested.

## Plan governance

- `PRODUCT_PLAN.md` defines approved strategic direction.
- `PRODUCT_START_PLAN.md` defines how discovery, design, validation, and staged delivery begin.
- `HANDOFF.md` records implementation truth, migrations, technical decisions, verification, and open issues.
- Material product decisions should be added to these documents when approved.
- Proposed ideas remain proposals until discussed and accepted.
- Code completion, production verification, user acceptance, and marketing readiness are separate milestones.
