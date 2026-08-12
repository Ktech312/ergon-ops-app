// Sends the client-facing Quote Proposal link by email via
// api/_lib/mailer.js (Gmail SMTP if configured, else Resend, else an
// honest "not configured" response), so the app can show a real status
// and fall back to "Copy client link" if nothing is set up.

import { sendEmail } from "./_lib/mailer.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send a proposal email." });
    return;
  }

  const { clientEmail, clientName, siteName, quoteRef, shareUrl } = req.body || {};

  if (!clientEmail || !shareUrl) {
    res.status(400).json({ sent: false, error: "clientEmail and shareUrl are required." });
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
