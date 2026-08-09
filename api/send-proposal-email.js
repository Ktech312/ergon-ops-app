// Sends the client-facing Quote Proposal link by email via Resend's HTTP
// API. Same env-var-gated pattern as api/send-submittal-email.js: if
// RESEND_API_KEY isn't set, this responds with { sent: false, reason: ... }
// instead of silently pretending to send, so the app can show an honest
// status and fall back to "Copy client link."
//
// To actually send email in production, add these Vercel project env vars:
//   RESEND_API_KEY       - API key from https://resend.com
//   PROPOSAL_FROM_EMAIL  - optional; a "Name <verified@yourdomain>" address
//                          from a domain verified in Resend. Defaults to
//                          Resend's shared onboarding@resend.dev sender.

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

  if (!process.env.RESEND_API_KEY) {
    res.status(200).json({
      sent: false,
      reason: "Email delivery isn't configured yet (RESEND_API_KEY is not set in Vercel), so no email was sent. The proposal was still created -- use Copy client link to share it manually.",
    });
    return;
  }

  const fromAddress = process.env.PROPOSAL_FROM_EMAIL || "Ergon Ops <onboarding@resend.dev>";
  const subjectSite = siteName || "your project";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [clientEmail],
        subject: `Proposal for ${subjectSite}${quoteRef ? ` (${quoteRef})` : ""}`,
        html: `
          <p>Hi ${clientName || "there"},</p>
          <p>Please review your proposal for <strong>${subjectSite}</strong>${quoteRef ? ` (${quoteRef})` : ""}.</p>
          <p><a href="${shareUrl}">Review and respond to the proposal</a></p>
          <p>Thanks,<br/>Ergon Ops</p>
        `,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      res.status(502).json({ sent: false, error: `Email provider returned ${response.status}: ${errorBody}` });
      return;
    }

    res.status(200).json({ sent: true });
  } catch (error) {
    res.status(500).json({ sent: false, error: error instanceof Error ? error.message : "Could not send proposal email." });
  }
}
