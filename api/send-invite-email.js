// Sends the real invite-with-signup-link email via api/_lib/mailer.js
// (Gmail SMTP if configured, else Resend, else an honest "not configured"
// response) so the Admin page can show a real status and fall back to
// "copy the invite link and send it yourself" if nothing is set up.

import { sendEmail } from "./_lib/mailer.js";
import { requireAuth } from "./_lib/requireAuth.js";
import { requireRole } from "./_lib/requireRole.js";
import { isAllowedAppUrl } from "./_lib/validateUrl.js";
import { checkRateLimit } from "./_lib/rateLimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send an invite email." });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }
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
