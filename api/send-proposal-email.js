// Sends the client-facing Quote Proposal link by email via
// api/_lib/mailer.js (Gmail SMTP if configured, else Resend, else an
// honest "not configured" response), so the app can show a real status
// and fall back to "Copy client link" if nothing is set up.

import { sendEmail } from "./_lib/mailer.js";
import { requireAuth } from "./_lib/requireAuth.js";
import { isAllowedAppUrl } from "./_lib/validateUrl.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send a proposal email." });
    return;
  }
  if (!(await requireAuth(req, res))) {
    return;
  }

  const { clientEmail, clientName, siteName, quoteRef, shareUrl } = req.body || {};

  if (!clientEmail || !shareUrl) {
    res.status(400).json({ sent: false, error: "clientEmail and shareUrl are required." });
    return;
  }
  // Security review, 2026-09-06: this legitimately emails an arbitrary
  // external client address (that's the feature) -- shareUrl is the
  // real risk, since an attacker-controlled link would ride on this
  // app's own trusted sender identity straight into a real client's
  // inbox.
  if (!isAllowedAppUrl(shareUrl)) {
    res.status(400).json({ sent: false, error: "shareUrl must point back to this app." });
    return;
  }

  const subjectSite = siteName || "your project";

  const result = await sendEmail({
    to: clientEmail,
    subject: `Proposal for ${subjectSite}${quoteRef ? ` (${quoteRef})` : ""}`,
    html: `
      <p>Hi ${clientName || "there"},</p>
      <p>Please review your proposal for <strong>${subjectSite}</strong>${quoteRef ? ` (${quoteRef})` : ""}.</p>
      <p><a href="${shareUrl}">Review and respond to the proposal</a></p>
      <p>Thanks,<br/>Ergon Ops</p>
    `,
  });

  res.status(result.sent || result.reason ? 200 : 502).json(result);
}
