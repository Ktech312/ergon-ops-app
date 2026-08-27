// Sends the client-facing submittal link by email via api/_lib/mailer.js
// (Gmail SMTP if configured, else Resend, else an honest "not configured"
// response), so the app can show the person a real status and fall back
// to "Copy client link" if nothing is set up.

import { sendEmail } from "./_lib/mailer.js";
import { requireAuth } from "./_lib/requireAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send a submittal email." });
    return;
  }
  if (!(await requireAuth(req, res))) {
    return;
  }

  const { clientEmail, clientName, projectName, projectRef, shareUrl } = req.body || {};

  if (!clientEmail || !shareUrl) {
    res.status(400).json({ sent: false, error: "clientEmail and shareUrl are required." });
    return;
  }

  const subjectProject = projectName || "your project";

  const result = await sendEmail({
    to: clientEmail,
    subject: `${subjectProject}${projectRef ? ` (${projectRef})` : ""} - Submittal for review`,
    html: `
      <p>Hi ${clientName || "there"},</p>
      <p>Please review the scope of work and bill of materials for <strong>${subjectProject}</strong>${projectRef ? ` (${projectRef})` : ""}.</p>
      <p><a href="${shareUrl}">Review and respond to the submittal</a></p>
      <p>Thanks,<br/>Ergon Ops</p>
    `,
  });

  res.status(result.sent || result.reason ? 200 : 502).json(result);
}
