// Generic email delivery for the notification engine (migration 024's
// notification_rules "Email" channel), via api/_lib/mailer.js (Gmail SMTP
// if configured, else Resend, else an honest "not configured" response).

import { sendEmail } from "./_lib/mailer.js";
import { requireAuth } from "./_lib/requireAuth.js";

// Security review, 2026-09-06 -- this had NO restriction on `to` at
// all: any signed-in user (even a brand-new, unapproved one) could
// call it with an arbitrary external address, subject, and body,
// making it an open relay riding on this app's own sender identity.
// The legitimate use is the in-app notify() engine alerting a real
// Ergon teammate about a real event -- so `to` must resolve to a real
// row in app_known_users (every signed-in user, migration 094), using
// the CALLER'S OWN access token so this can never see more than they
// already could. External recipients (clients, vendors) go through the
// separate, purpose-built proposal/submittal routes instead, which
// keep the email-address freedom those legitimately need.
async function isKnownErgonUser(email, accessToken) {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return false;
  }
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/app_known_users?email=ilike.${encodeURIComponent(email)}&select=user_id`,
      { headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      return false;
    }
    const rows = await response.json();
    return rows.length > 0;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send a notification email." });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const { to, subject, body, companyName } = req.body || {};

  if (!to || !subject) {
    res.status(400).json({ sent: false, error: "to and subject are required." });
    return;
  }
  if (typeof subject !== "string" || subject.length > 300 || typeof body === "string" && body.length > 10000) {
    res.status(400).json({ sent: false, error: "subject or body is too long." });
    return;
  }
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!(await isKnownErgonUser(to, token))) {
    res.status(403).json({ sent: false, error: "This route only notifies known Ergon users, not arbitrary addresses." });
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
