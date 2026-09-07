// Generic email delivery for the notification engine (migration 024's
// notification_rules "Email" channel), via api/_lib/mailer.js (Gmail SMTP
// if configured, else Resend, else an honest "not configured" response).

import { sendEmail } from "./_lib/mailer.js";
import { requireAuth } from "./_lib/requireAuth.js";
import { loadNotificationById, hasExistingDelivery } from "./_lib/notificationLookup.js";
import { checkRateLimit } from "./_lib/rateLimit.js";

// Security review, 2026-09-06 -- this had NO restriction on `to` at
// all: any signed-in user (even a brand-new, unapproved one) could
// call it with an arbitrary external address, subject, and body,
// making it an open relay riding on this app's own sender identity.
// The legitimate use is the in-app notify() engine alerting a real
// Ergon teammate about a real event -- so the recipient must resolve to
// a real row in app_known_users (every signed-in user, migration 094).
// External recipients (clients, vendors) go through the separate,
// purpose-built proposal/submittal routes instead, which keep the
// email-address freedom those legitimately need.
//
// Security review, 2026-09-07 -- that still let a caller send arbitrary
// subject/body to a real known recipient, independent of whatever it
// actually wrote to the `notifications` table for the same event. Now
// takes only a `notificationId`; the recipient/subject/body always come
// from that already-created row (via the service-role key, since a
// caller usually isn't the row's own recipient and couldn't read it
// back with their own token) -- see api/_lib/notificationLookup.js for
// the full reasoning and its limits.
async function isKnownErgonUser(email, supabaseUrl, serviceRoleKey) {
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/app_known_users?email=ilike.${encodeURIComponent(email)}&select=user_id`,
      { headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` } },
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
  if (!(await checkRateLimit(`notification-email:${user.id}`, 30, 60_000))) {
    res.status(429).json({ sent: false, error: "Too many notification emails sent -- please slow down." });
    return;
  }

  const { notificationId } = req.body || {};
  if (!notificationId || typeof notificationId !== "string") {
    res.status(400).json({ sent: false, error: "notificationId is required." });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    res.status(200).json({ sent: false, reason: "Email delivery isn't fully configured yet." });
    return;
  }

  const notification = await loadNotificationById(notificationId, supabaseUrl, serviceRoleKey);
  if (!notification) {
    res.status(404).json({ sent: false, error: "That notification doesn't exist." });
    return;
  }
  if (typeof notification.title !== "string" || notification.title.length > 300 || (typeof notification.body === "string" && notification.body.length > 10000)) {
    res.status(400).json({ sent: false, error: "That notification's subject or body is too long to email." });
    return;
  }
  if (!(await isKnownErgonUser(notification.recipient_email, supabaseUrl, serviceRoleKey))) {
    res.status(403).json({ sent: false, error: "This route only notifies known Ergon users, not arbitrary addresses." });
    return;
  }
  if (await hasExistingDelivery(notificationId, "email", supabaseUrl, serviceRoleKey)) {
    res.status(200).json({ sent: false, reason: "Already delivered." });
    return;
  }

  const company = "Ergon Ops";
  const result = await sendEmail({
    to: notification.recipient_email,
    subject: notification.title,
    fromName: company,
    html: `<p>${(notification.body || "").replace(/\n/g, "<br/>")}</p><p>-- ${company}</p>`,
  });

  res.status(result.sent || result.reason ? 200 : 502).json(result);
}
