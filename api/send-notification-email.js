// Generic email delivery for the notification engine (migration 024's
// notification_rules "Email" channel) via Resend's HTTP API. Before this
// endpoint existed, toggling "Email" on for an event type in Admin ->
// Notification Rules did nothing -- the checkbox was disabled with "not
// configured yet" even after RESEND_API_KEY was set for Submittals/Invites,
// which wasn't actually true anymore. Same honest-fallback pattern as
// api/send-submittal-email.js and api/send-invite-email.js: if the key
// isn't set, responds { sent: false, reason: ... } instead of pretending.

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

  if (!process.env.RESEND_API_KEY) {
    res.status(200).json({
      sent: false,
      reason: "Email delivery isn't configured yet (RESEND_API_KEY is not set in Vercel), so no email was sent.",
    });
    return;
  }

  const company = companyName || "Ergon Ops";
  const fromAddress = process.env.SUBMITTAL_FROM_EMAIL || `${company} <onboarding@resend.dev>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        subject,
        html: `<p>${(body || "").replace(/\n/g, "<br/>")}</p><p>-- ${company}</p>`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      res.status(502).json({ sent: false, error: `Email provider returned ${response.status}: ${errorBody}` });
      return;
    }

    res.status(200).json({ sent: true });
  } catch (error) {
    res.status(500).json({ sent: false, error: error instanceof Error ? error.message : "Could not send notification email." });
  }
}
