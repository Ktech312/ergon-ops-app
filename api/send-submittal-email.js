// Sends the client-facing submittal link by email via Resend's HTTP API.
// Before this endpoint existed, the "Create & Send Submittal" button in the
// Projects view only ever created a database row and a share token -- no
// email was ever transmitted, regardless of whether a client email address
// was entered. This mirrors the same env-var-gated pattern already used by
// api/sales-quote-extract.js: if RESEND_API_KEY isn't set, this responds
// with { sent: false, reason: ... } instead of silently pretending to send,
// so the app can show the person an honest status.
//
// To actually send email in production, add these Vercel project env vars:
//   RESEND_API_KEY        - API key from https://resend.com
//   SUBMITTAL_FROM_EMAIL  - optional; a "Name <verified@yourdomain>" address
//                           from a domain verified in Resend. Defaults to
//                           Resend's shared onboarding@resend.dev sender,
//                           which works for testing but should be replaced
//                           with a verified EnSight domain for real client
//                           mail.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send a submittal email." });
    return;
  }

  const { clientEmail, clientName, projectName, projectRef, shareUrl } = req.body || {};

  if (!clientEmail || !shareUrl) {
    res.status(400).json({ sent: false, error: "clientEmail and shareUrl are required." });
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    res.status(200).json({
      sent: false,
      reason: "Email delivery isn't configured yet (RESEND_API_KEY is not set in Vercel), so no email was sent. The submittal was still created -- use Copy client link to share it manually.",
    });
    return;
  }

  const fromAddress = process.env.SUBMITTAL_FROM_EMAIL || "Ergon Ops <onboarding@resend.dev>";
  const subjectProject = projectName || "your project";

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
        subject: `${subjectProject}${projectRef ? ` (${projectRef})` : ""} - Submittal for review`,
        html: `
          <p>Hi ${clientName || "there"},</p>
          <p>Please review the scope of work and bill of materials for <strong>${subjectProject}</strong>${projectRef ? ` (${projectRef})` : ""}.</p>
          <p><a href="${shareUrl}">Review and respond to the submittal</a></p>
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
    res.status(500).json({ sent: false, error: error instanceof Error ? error.message : "Could not send submittal email." });
  }
}
