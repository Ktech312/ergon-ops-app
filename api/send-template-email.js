// Consolidated client/invite email dispatcher -- Vercel Hobby plan caps
// a deployment at 12 serverless functions (every api/*.js file except
// the underscore-prefixed api/_lib/ helpers counts); this app was
// already at that cap before migration 190's forward-attachment.js
// tipped it over. Merges three previously separate routes
// (send-invite-email.js, send-proposal-email.js, send-submittal-email.js)
// into one file, dispatched on `req.body.template`. This is a pure
// file-consolidation refactor -- every branch below is that route's own
// handler body, carried forward UNCHANGED (same validation, same
// auth/role/rate-limit checks, same rate-limit KEY STRINGS -- System
// Health's own rate-limit surface breakdown is keyed by the string
// before the first ":", so changing these would silently reshape
// existing System Health history --, same response shapes, same status
// codes). See HANDOFF.md's "URGENT" entry (2026-09-21) for the full
// incident this fixes.

import { sendEmail } from "./_lib/mailer.js";
import { requireAuth } from "./_lib/requireAuth.js";
import { requireRole } from "./_lib/requireRole.js";
import { isAllowedAppUrl } from "./_lib/validateUrl.js";
import { checkRateLimit } from "./_lib/rateLimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send an email." });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const { template } = req.body || {};
  if (template === "invite") {
    await handleInvite(req, res, user);
    return;
  }
  if (template === "proposal") {
    await handleProposal(req, res, user);
    return;
  }
  if (template === "submittal") {
    await handleSubmittal(req, res, user);
    return;
  }
  res.status(400).json({ sent: false, error: "template must be one of: invite, proposal, submittal." });
}

// ============================================================
// template: "invite" -- formerly api/send-invite-email.js, verbatim.
// ============================================================

async function handleInvite(req, res, user) {
  // Inviting someone creates their access to this app -- admin-only,
  // same trust level as the rest of Admin's user-management actions.
  if (!(await requireRole(req, res, user, []))) {
    return;
  }
  if (!(await checkRateLimit(`invite-email:${user.id}`, 20, 60_000))) {
    res.status(429).json({ sent: false, error: "Too many invites sent -- please slow down." });
    return;
  }

  const { email, fullName, roleLabel, inviteUrl, companyName } = req.body || {};

  if (!email || !inviteUrl) {
    res.status(400).json({ sent: false, error: "email and inviteUrl are required." });
    return;
  }
  if (typeof email !== "string" || email.length > 320 || !email.includes("@")) {
    res.status(400).json({ sent: false, error: "That doesn't look like a valid email address." });
    return;
  }
  if (!isAllowedAppUrl(inviteUrl)) {
    res.status(400).json({ sent: false, error: "inviteUrl must point back to this app." });
    return;
  }

  const company = companyName || "Ergon Ops";
  const greetingName = fullName || email;
  const roleText = roleLabel || "team";

  const result = await sendEmail({
    to: email,
    fromName: company,
    subject: `Welcome ${greetingName} - you've been invited to the ${roleText} team`,
    html: `
      <p>Welcome ${greetingName},</p>
      <p>You have been invited to join the <strong>${roleText}</strong> team on ${company}.</p>
      <p><a href="${inviteUrl}">Accept your invite and set up your account</a></p>
      <p>This link is unique to you and expires in 30 days -- please don't forward it.</p>
      <p>Thanks,<br/>${company}</p>
    `,
  });

  res.status(result.sent || result.reason ? 200 : 502).json(result);
}

// ============================================================
// template: "proposal" -- formerly api/send-proposal-email.js, verbatim.
// ============================================================

async function handleProposal(req, res, user) {
  if (!(await requireRole(req, res, user, ["sales", "pm", "manager"]))) {
    return;
  }
  if (!(await checkRateLimit(`proposal-email:${user.id}`, 20, 60_000))) {
    res.status(429).json({ sent: false, error: "Too many proposal emails sent -- please slow down." });
    return;
  }

  const { proposalId, shareUrl } = req.body || {};
  if (!proposalId || typeof proposalId !== "string" || !shareUrl) {
    res.status(400).json({ sent: false, error: "proposalId and shareUrl are required." });
    return;
  }
  if (!isAllowedAppUrl(shareUrl)) {
    res.status(400).json({ sent: false, error: "shareUrl must point back to this app." });
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    res.status(200).json({ sent: false, reason: "Not configured." });
    return;
  }
  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  let proposal;
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/sales_quote_proposals?id=eq.${encodeURIComponent(proposalId)}&select=quote_id,client_name,client_email,content_snapshot`,
      { headers: { apikey: anonKey, authorization: `Bearer ${callerToken}` } },
    );
    if (!response.ok) {
      res.status(502).json({ sent: false, error: "Could not look up that proposal." });
      return;
    }
    const rows = await response.json();
    proposal = rows[0];
  } catch {
    res.status(502).json({ sent: false, error: "Could not look up that proposal." });
    return;
  }
  if (!proposal) {
    res.status(404).json({ sent: false, error: "That proposal doesn't exist." });
    return;
  }
  if (!proposal.client_email) {
    res.status(400).json({ sent: false, error: "That proposal has no client email on file." });
    return;
  }

  const clientEmail = proposal.client_email;
  const clientName = proposal.client_name || "there";
  const siteName = proposal.content_snapshot?.siteName || "your project";
  const quoteRef = proposal.content_snapshot?.quoteRef || "";
  const companyName = (proposal.content_snapshot?.companyName || "").trim() || "Ergon";

  const result = await sendEmail({
    to: clientEmail,
    subject: `Proposal for ${siteName}${quoteRef ? ` (${quoteRef})` : ""}`,
    html: `
      <p>Hi ${clientName},</p>
      <p>Please review your proposal for <strong>${siteName}</strong>${quoteRef ? ` (${quoteRef})` : ""}.</p>
      <p><a href="${shareUrl}">Review and respond to the proposal</a></p>
      <p>Thanks,<br/>${companyName}</p>
    `,
  });

  res.status(result.sent || result.reason ? 200 : 502).json(result);
}

// ============================================================
// template: "submittal" -- formerly api/send-submittal-email.js,
// verbatim.
// ============================================================

async function handleSubmittal(req, res, user) {
  if (!(await requireRole(req, res, user, ["pm"]))) {
    return;
  }
  if (!(await checkRateLimit(`submittal-email:${user.id}`, 20, 60_000))) {
    res.status(429).json({ sent: false, error: "Too many submittal emails sent -- please slow down." });
    return;
  }

  const { submittalId, shareUrl } = req.body || {};
  if (!submittalId || typeof submittalId !== "string" || !shareUrl) {
    res.status(400).json({ sent: false, error: "submittalId and shareUrl are required." });
    return;
  }
  if (!isAllowedAppUrl(shareUrl)) {
    res.status(400).json({ sent: false, error: "shareUrl must point back to this app." });
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    res.status(200).json({ sent: false, reason: "Not configured." });
    return;
  }
  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  let submittal;
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/project_submittals?id=eq.${encodeURIComponent(submittalId)}&select=client_name,client_email,content_snapshot`,
      { headers: { apikey: anonKey, authorization: `Bearer ${callerToken}` } },
    );
    if (!response.ok) {
      res.status(502).json({ sent: false, error: "Could not look up that submittal." });
      return;
    }
    const rows = await response.json();
    submittal = rows[0];
  } catch {
    res.status(502).json({ sent: false, error: "Could not look up that submittal." });
    return;
  }
  if (!submittal) {
    res.status(404).json({ sent: false, error: "That submittal doesn't exist." });
    return;
  }
  if (!submittal.client_email) {
    res.status(400).json({ sent: false, error: "That submittal has no client email on file." });
    return;
  }

  const clientEmail = submittal.client_email;
  const clientName = submittal.client_name || "there";
  const projectName = submittal.content_snapshot?.projectName || "your project";
  const projectRef = submittal.content_snapshot?.projectRef || "";
  const companyName = (submittal.content_snapshot?.companyName || "").trim() || "Ergon";

  const result = await sendEmail({
    to: clientEmail,
    subject: `${projectName}${projectRef ? ` (${projectRef})` : ""} - Submittal for review`,
    html: `
      <p>Hi ${clientName},</p>
      <p>Please review the scope of work and bill of materials for <strong>${projectName}</strong>${projectRef ? ` (${projectRef})` : ""}.</p>
      <p><a href="${shareUrl}">Review and respond to the submittal</a></p>
      <p>Thanks,<br/>${companyName}</p>
    `,
  });

  res.status(result.sent || result.reason ? 200 : 502).json(result);
}
