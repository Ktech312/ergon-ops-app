// Sends the client-facing Quote Proposal link by email via
// api/_lib/mailer.js (Gmail SMTP if configured, else Resend, else an
// honest "not configured" response), so the app can show a real status
// and fall back to "Copy client link" if nothing is set up.

import { sendEmail } from "./_lib/mailer.js";
import { requireAuth } from "./_lib/requireAuth.js";
import { requireRole } from "./_lib/requireRole.js";
import { isAllowedAppUrl } from "./_lib/validateUrl.js";
import { checkRateLimit } from "./_lib/rateLimit.js";

// Security review, 2026-09-07 -- this had no role check at all (any
// signed-in user, any role) and trusted clientEmail/clientName/siteName/
// quoteRef exactly as sent, independent of the real sales_quote_proposals
// row the client had just created moments earlier. Sales quotes/
// proposals have no per-user "assigned to" field to check against
// (sales_quotes' own RLS is deliberately open to any authenticated user
// -- "no single role owns this workflow," see migration 033's comment)
// -- so "roles permitted to manage the related sales quote" is enforced
// as the roles that actually work quotes day to day (sales/pm/manager),
// same set sales-quote-extract already used. clientName/clientEmail/
// siteName/quoteRef now come from the proposal row itself (via the
// caller's own token -- proposals are readable by any authenticated
// user, same open-workflow trust boundary as quotes) instead of a
// second, independently supplied payload -- shareUrl is still validated
// separately since it legitimately isn't stored plainly anywhere to
// re-derive from.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send a proposal email." });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }
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
  // The real quote_ref (e.g. "SQ-2026-0001"), read from this proposal's own
  // frozen content_snapshot rather than re-derived from quote_id -- fixed
  // 2026-09-08, previously fabricated a fake ref from quote_id.slice(0, 8).
  // Reading from the snapshot (instead of joining sales_quotes fresh) is
  // deliberate: it always displays whatever ref that specific proposal was
  // actually sent with, matching what the customer sees on the public
  // proposal page, and never touches historical content_snapshot rows.
  const quoteRef = proposal.content_snapshot?.quoteRef || "";

  const result = await sendEmail({
    to: clientEmail,
    subject: `Proposal for ${siteName}${quoteRef ? ` (${quoteRef})` : ""}`,
    html: `
      <p>Hi ${clientName},</p>
      <p>Please review your proposal for <strong>${siteName}</strong>${quoteRef ? ` (${quoteRef})` : ""}.</p>
      <p><a href="${shareUrl}">Review and respond to the proposal</a></p>
      <p>Thanks,<br/>Ergon Ops</p>
    `,
  });

  res.status(result.sent || result.reason ? 200 : 502).json(result);
}
