// Sends the real invite-with-signup-link email via Resend's HTTP API, same
// env-var-gated pattern as api/send-submittal-email.js: if RESEND_API_KEY
// isn't set, this responds with { sent: false, reason: ... } instead of
// silently pretending to send, so the Admin page can show an honest status
// and fall back to "copy the invite link and send it yourself."
//
// Uses the same Vercel env vars already configured for Submittals:
//   RESEND_API_KEY        - API key from https://resend.com
//   SUBMITTAL_FROM_EMAIL   - optional "Name <verified@yourdomain>" sender

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send an invite email." });
    return;
  }

  const { email, fullName, roleLabel, inviteUrl, companyName } = req.body || {};

  if (!email || !inviteUrl) {
    res.status(400).json({ sent: false, error: "email and inviteUrl are required." });
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    res.status(200).json({
      sent: false,
      reason: "Email delivery isn't configured yet (RESEND_API_KEY is not set in Vercel), so no email was sent. The invite was still created -- use Copy invite link to share it manually.",
    });
    return;
  }

  const company = companyName || "Ergon Ops";
  const fromAddress = process.env.SUBMITTAL_FROM_EMAIL || `${company} <onboarding@resend.dev>`;
  const greetingName = fullName || email;
  const roleText = roleLabel || "team";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [email],
        subject: `Welcome ${greetingName} - you've been invited to the ${roleText} team`,
        html: `
          <p>Welcome ${greetingName},</p>
          <p>You have been invited to join the <strong>${roleText}</strong> team on ${company}.</p>
          <p><a href="${inviteUrl}">Accept your invite and set up your account</a></p>
          <p>This link is unique to you and expires in 30 days -- please don't forward it.</p>
          <p>Thanks,<br/>${company}</p>
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
    res.status(500).json({ sent: false, error: error instanceof Error ? error.message : "Could not send invite email." });
  }
}
