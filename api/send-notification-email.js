// Generic email delivery for the notification engine (migration 024's
// notification_rules "Email" channel), via api/_lib/mailer.js (Gmail SMTP
// if configured, else Resend, else an honest "not configured" response).

import { sendEmail } from "./_lib/mailer.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send a notification email." });
    return;
  }

  const { to, subject, body, companyName } = req.body || {};

  if (!to || !subject) {
    res.status(400).json({ sent: false, error: "to and subject are required." });
    return;
  }

  const company = companyName || "Ergon Ops";

  const result = await sendEmail({
    to,
    subject,
    fromName: company,
    html: `<p>${(body || "").replace(/\n/g, "<br/>")}</p><p>-- ${company}</p>`,
  });

  res.status(result.sent || result.reason ? 200 : 502).json(result);
}
