# Quote & Submittal PDF Generator — Scoping Doc

Written overnight per your request: draft the Sales Estimator/BOM into a client-facing document (general template + per-project fill-in) that's 80-90% automated, sent to a client to sign and return. I did **not** write any code for this — it's consequential (client-facing, financial, needs a real signature story) and I'd rather hand you a clear plan and a short list of decisions than guess and build the wrong thing. Everything below is based on what's actually in the codebase today, not assumptions.

## What already exists that this can build on

You already have almost this exact workflow for a different stage of the project — the **Submittals** feature (post-sale, sent from a Project once it's won):

- A submittal freezes a snapshot of the SOW + BOM into one JSON blob at send time.
- It's emailed to a client via a real email API (Resend) with a unique link.
- The client opens a public page (no login) and sees the SOW/BOM rendered as HTML.
- "Signing" isn't a real e-signature — it's a typed name + Approve/Request Revision/Reject buttons, and the system hashes what was shown and stores that hash alongside the approval for an audit trail. That's a deliberate, honest design choice already made once in this codebase (the migration comment literally says "audit-trailed click-to-approve, not a third-party e-signature").
- All of the plumbing — the public-page routing, the share-token system, the Resend email sending — is generic enough to reuse for a new document type, not just submittals.

**What's missing:** there's no PDF generation anywhere in this app today. The two PDF-related libraries installed (`pdf-parse`, `pdfjs-dist`) only *read* PDFs (that's how vendor quotes get imported) — nothing *writes* one. A literal PDF file would be new infrastructure, not a small add-on.

## The one big fork in the road

**Option A — Reuse the Submittal pattern exactly, for Quotes too.** Build a "Quote Proposal" the same way: freeze the BOM/pricing/client info into a snapshot, email a link, client reviews an HTML page and clicks to approve (same audit-hash trick). Add a "Print / Save as PDF" button using the browser's native print-to-PDF — looks like a real document, no new library needed. This is by far the fastest to build well, because 90% of the hard parts (token security, email delivery, audit trail) already exist and are proven.

**Option B — Generate an actual PDF file.** Needs a real PDF library (client-side like `pdf-lib`/`jsPDF`, or a server-side renderer), a template layout built in that library's API (not just HTML/CSS), somewhere to store the generated file (a new Storage bucket, same pattern as the datasheets bucket I just built), and you'd still need the same email+signature layer as Option A on top of it. This is a genuinely bigger build, and the "signature" question below still applies on top of it.

My instinct is **Option A**, possibly with a "Download PDF" convenience button layered on later — it gets you a real, working, sendable document fastest, and it's the same shape of trust decision you already made for Submittals. But this is your call, not mine to make silently.

## Where in the sales flow does this fire?

Today, "closed_won" is the line: Submittals happen *after* a quote is won, at the Project level. What you're describing — a formal proposal built from the Estimator/BOM — sounds like it needs to happen *before* that, while a quote is still open, as the document that convinces the client to say yes. That's a new moment in the flow, not a variant of the existing one. Worth confirming that's the intent.

## Questions I need real answers to (not guessing on these)

1. **PDF or HTML-that-prints-like-a-PDF?** (Option A vs B above.)
2. **Signature**: is a typed-name-and-click audit trail (like Submittals) good enough for this, or does a formal sales proposal need something more — an actual drawn/uploaded signature, or a real e-signature service like DocuSign/HelloSign (that's a paid third-party integration, separate decision)?
3. **What goes in the "general template" section?** Company letterhead (logo's done), standard terms & conditions, payment terms, validity period, warranty language — do you have existing boilerplate text I should drop in, or does that need to be written?
4. **What's the "fill in per project" section, exactly?** I'm assuming: client name/site, the BOM line items with quantities and sell prices (all of which already exist on a Sales Quote), maybe a scope-of-work summary. Anything else that has to appear per-deal?
5. **Where does a signed/approved proposal live afterward?** Same idea as submittals (status + response stored on the quote itself), or does it need to become a permanent stored document (like Project Documents)?
6. **Does this apply to Submittals too**, or just the new pre-sale Quote proposal? You mentioned both estimator/BOM *and* Submittals in the same breath — want to confirm whether Submittals should also get a PDF-style upgrade, or if it's fine as the HTML page it is today.

Answer these whenever you're up, and I can scope the actual build (migration + persistence + UI) same-day.
