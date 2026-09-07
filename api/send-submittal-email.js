// Sends the client-facing submittal link by email via api/_lib/mailer.js
// (Gmail SMTP if configured, else Resend, else an honest "not configured"
// response), so the app can show the person a real status and fall back
// to "Copy client link" if nothing is set up.

import { sendEmail } from "./_lib/mailer.js";
import { requireAuth } from "./_lib/requireAuth.js";
import { requireRole } from "./_lib/requireRole.js";
import { isAllowedAppUrl } from "./_lib/validateUrl.js";
import { checkRateLimit } from "./_lib/rateLimit.js";

// Security review, 2026-09-07 -- this had no role check at all, and
// trusted clientEmail/clientName/projectName/projectRef exactly as sent
// rather than the real project_submittals row the client had just
// created moments earlier. "Roles permitted to manage the related
// project" is enforced as `pm` (+admin) -- the only roles that can
// actually write project_submittals at all per its own RLS (migration
// 025: "pm and admin write project_submittals"); a manager-role caller
// was never able to successfully create a submittal in the first place
// (the DB write would already fail), so this doesn't remove anyone's
// working access, it just fails fast with a clear reason instead of a
// confusing downstream DB error. clientName/clientEmail/projectName/
// projectRef now come from the submittal row itself (via the caller's
// own token -- submittals are readable by any authenticated user) rather
// than a second, independently supplied payload.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send a submittal email." });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }
  if (!(await requireRole(req, res, user, ["pm"]))) {
    return;
  }
  if (!checkRateLimit(`submittal-email:${user.id}`, 20, 60_000)) {
    res.status(429).json({ sent: false, error: "Too many submittal emails sent -- please slow down." });
    return;
  }

  const { submittalId, shareUrl } = req.body || {};
  if (!submittalId || typeof submittalId !== "string" || !shareUrl) {
    res.status(400).json({ sent: false, error: "submittalId and shareUrl are required." });
    return;
  }
  if (!isAllowedAppUrl(shareUrl)) {
    res.status(400).json({ sent: false, error: "shareUrl must point back to this app." });
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    res.status(200).json({ sent: false, reason: "Not configured." });
    return;
  }
  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  let submittal;
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/project_submittals?id=eq.${encodeURIComponent(submittalId)}&select=client_name,client_email,content_snapshot`,
      { headers: { apikey: anonKey, authorization: `Bearer ${callerToken}` } },
    );
    if (!response.ok) {
      res.status(502).json({ sent: false, error: "Could not look up that submittal." });
      return;
    }
    const rows = await response.json();
    submittal = rows[0];
  } catch {
    res.status(502).json({ sent: false, error: "Could not look up that submittal." });
    return;
  }
  if (!submittal) {
    res.status(404).json({ sent: false, error: "That submittal doesn't exist." });
    return;
  }
  if (!submittal.client_email) {
    res.status(400).json({ sent: false, error: "That submittal has no client email on file." });
    return;
  }

  const clientEmail = submittal.client_email;
  const clientName = submittal.client_name || "there";
  const projectName = submittal.content_snapshot?.projectName || "your project";
  const projectRef = submittal.content_snapshot?.projectRef || "";

  const result = await sendEmail({
    to: clientEmail,
    subject: `${projectName}${projectRef ? ` (${projectRef})` : ""} - Submittal for review`,
    html: `
      <p>Hi ${clientName},</p>
      <p>Please review the scope of work and bill of materials for <strong>${projectName}</strong>${projectRef ? ` (${projectRef})` : ""}.</p>
      <p><a href="${shareUrl}">Review and respond to the submittal</a></p>
      <p>Thanks,<br/>Ergon Ops</p>
    `,
  });

  res.status(result.sent || result.reason ? 200 : 502).json(result);
}
