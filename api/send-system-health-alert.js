// System Health alert/recovery delivery (migration 152, Queue R1 item
// 1's step 5, per E's 2026-09-16 decision). The SQL side (migrations
// 151/152) owns the durable state and the threshold decision -- this
// route's only job is sending the actual email, matching every other
// email send in this app going through api/_lib/mailer.js. Only reached
// from browser-triggered call sites (restoreFullBackupSnapshot,
// recordNotificationDelivery) via persistence.ts; server-side call sites
// (cron, rate-limit) send directly through api/_lib/systemHealth.js
// without an extra HTTP hop, since they already run in the same Node
// process as the mailer.
//
// Never trusts client-supplied recipient data -- admin emails are always
// re-derived server-side via list_admin_emails() (migration 152,
// service-role-only), even though the caller already received the same
// list from the RPC -- a compromised or buggy client must not be able to
// redirect this to arbitrary addresses. Same discipline
// api/send-notification-email.js already established after its own
// 2026-09-06/07 security reviews.
import { requireAuth } from "./_lib/requireAuth.js";
import { sendEmail } from "./_lib/mailer.js";
import { checkRateLimit } from "./_lib/rateLimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ sent: false, error: "Use POST." });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }
  // Matches every other mailer-triggering route's own rate limit
  // (e.g. api/send-notification-email.js) -- the SQL layer already
  // guarantees at most one alert per open incident, so this is
  // defense-in-depth against a buggy/malicious client hammering the
  // route directly, not the primary throttle.
  if (!(await checkRateLimit(`system-health-alert:${user.id}`, 10, 60_000))) {
    res.status(429).json({ sent: false, error: "Too many System Health alert requests -- please slow down." });
    return;
  }

  const { kind, surface, entityType, entityId, failureReasonCode, severity, occurrenceCount, safeDetail } = req.body || {};
  if (kind !== "alert" && kind !== "recovery") {
    res.status(400).json({ sent: false, error: "kind must be 'alert' or 'recovery'." });
    return;
  }
  if (!surface || !failureReasonCode) {
    res.status(400).json({ sent: false, error: "surface and failureReasonCode are required." });
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(200).json({ sent: false, reason: "Not configured." });
    return;
  }

  let adminEmails = [];
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/list_admin_emails`, {
      method: "POST",
      headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (response.ok) {
      adminEmails = (await response.json()) || [];
    } else {
      console.error(`[send-system-health-alert] list_admin_emails failed: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error("[send-system-health-alert] Could not load admin emails:", error instanceof Error ? error.message : error);
  }

  if (!Array.isArray(adminEmails) || adminEmails.length === 0) {
    res.status(200).json({ sent: false, reason: "No admin recipients found." });
    return;
  }

  const subject =
    kind === "alert"
      ? `System Health: ${surface} is DOWN (${failureReasonCode})`
      : `System Health: ${surface} recovered (${failureReasonCode})`;
  const body =
    kind === "alert"
      ? `<p>A repeated failure has crossed the alert threshold (3+ consecutive occurrences, spanning at least 5 minutes, no successful event in between).</p>
         <p><strong>Surface:</strong> ${surface}<br/><strong>Entity type:</strong> ${entityType || "n/a"}<br/><strong>Entity id:</strong> ${entityId || "n/a"}<br/><strong>Reason:</strong> ${failureReasonCode}<br/><strong>Severity:</strong> ${severity || "n/a"}<br/><strong>Occurrences:</strong> ${occurrenceCount ?? "n/a"}</p>
         <p>Check the System Health -- Events panel in Ergon Ops (Admin page) for full detail.</p>`
      : `<p>The following System Health incident has recovered -- a successful event was recorded for the same surface/reason.</p>
         <p><strong>Surface:</strong> ${surface}<br/><strong>Reason:</strong> ${failureReasonCode}</p>`;

  let sentCount = 0;
  for (const email of adminEmails) {
    const result = await sendEmail({ to: email, subject, html: body, fromName: "Ergon Ops System Health" });
    if (result.sent) {
      sentCount += 1;
    }
  }

  console.log(`[send-system-health-alert] kind=${kind} surface=${surface} reason=${failureReasonCode} sent=${sentCount}/${adminEmails.length}`);
  res.status(200).json({ sent: sentCount > 0, sentCount, recipientCount: adminEmails.length, safeDetail: safeDetail ?? null });
}
