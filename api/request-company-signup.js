// The one public, unauthenticated entry point for self-serve company
// signup (Stage 7 onboarding, PRODUCT_ONBOARDING_CONFIG.md's 2026-09-22
// update -- E: "let's start with lightweight"). Backend migration:
// backend/supabase/migrations/195_company_signup_requests.sql.
//
// This is deliberately the ONLY way to reach
// submit_company_signup_request() -- that RPC has no anon/authenticated
// grant at all (see the migration's own header), so a direct
// rpc/submit_company_signup_request call from a browser or a raw curl
// hitting Supabase directly is a plain 403, not just "unlikely." The only
// path in is this route, using the service-role key server-side, which
// is exactly why this route exists at all instead of just granting anon
// EXECUTE the way get_company_signup_by_token/get_channel_guest_invite_by_token
// (pure reads) already do -- a public WRITE needs real rate limiting,
// which Postgres/RLS has no concept of, and this route is where that
// layer lives.
//
// No requireAuth() here -- there is no session to require. Abuse
// protection is IP + email based instead of caller-id based (every other
// rate-limited route in this app keys by an authenticated caller.id,
// which doesn't exist for an anonymous signup request).

import { checkRateLimit } from "./_lib/rateLimit.js";
import { sendEmail } from "./_lib/mailer.js";
import { recordSystemHealthEventServerSide } from "./_lib/systemHealth.js";

const MAX_LENGTH = { companyName: 200, requesterName: 200, requesterEmail: 320 };
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to request a company signup." });
    return;
  }

  const { companyName, requesterName, requesterEmail } = req.body || {};
  if (typeof companyName !== "string" || companyName.trim().length === 0 || companyName.trim().length > MAX_LENGTH.companyName) {
    res.status(400).json({ error: `companyName is required and must be at most ${MAX_LENGTH.companyName} characters.` });
    return;
  }
  if (typeof requesterName !== "string" || requesterName.trim().length === 0 || requesterName.trim().length > MAX_LENGTH.requesterName) {
    res.status(400).json({ error: `requesterName is required and must be at most ${MAX_LENGTH.requesterName} characters.` });
    return;
  }
  if (typeof requesterEmail !== "string" || !EMAIL_PATTERN.test(requesterEmail.trim()) || requesterEmail.trim().length > MAX_LENGTH.requesterEmail) {
    res.status(400).json({ error: "requesterEmail must be a valid-looking email address." });
    return;
  }

  const ip = clientIp(req);
  const normalizedEmail = requesterEmail.trim().toLowerCase();

  // Two independent limits, both modest: an IP hammering this endpoint
  // with different emails, and one email retrying past a legitimate
  // "I already submitted" mistake. Neither alone would catch both abuse
  // shapes.
  if (!(await checkRateLimit(`company-signup-ip:${ip}`, 10, 60 * 60_000))) {
    res.status(429).json({ error: "Too many signup requests from this network -- please try again later." });
    return;
  }
  if (!(await checkRateLimit(`company-signup-email:${normalizedEmail}`, 3, 24 * 60 * 60_000))) {
    res.status(429).json({ error: "Too many signup requests for this email address -- please try again later, or check whether you already submitted one." });
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(200).json({ submitted: false, reason: "Not configured." });
    return;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/submit_company_signup_request`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      p_company_name: companyName.trim(),
      p_requester_name: requesterName.trim(),
      p_requester_email: normalizedEmail,
    }),
  });

  if (!response.ok) {
    // The RPC's own validation errors (empty/oversized fields, malformed
    // email) surface here too, past this route's own looser pre-checks --
    // never leak the raw Postgres error text to an anonymous caller.
    res.status(400).json({ error: "Could not submit this signup request. Please check the details and try again." });
    return;
  }

  const requestId = await response.json();

  // Item 7 of the login-page redesign spec: notify platform admins, never
  // ordinary company admins. The request itself already succeeded above
  // (submitted:true is earned) -- nothing from here down may ever change
  // that response, so this is awaited (a Vercel serverless function's
  // execution can be frozen the instant the response is sent -- a
  // fire-and-forget call here could simply never run) but wrapped in its
  // own try/catch so a genuinely unexpected failure still can't turn a
  // successful submission into an error response. A mail failure
  // specifically must not lose the request; it stays visible in the
  // platform queue (CompanySignupRequestsPanel already reads every
  // 'pending' row directly, independent of whether a notification ever
  // went out) and is recorded to System Health instead of silently
  // swallowed.
  try {
    await notifyPlatformAdmins({ supabaseUrl, serviceRoleKey, requestId, companyName: companyName.trim(), requesterName: requesterName.trim(), requesterEmail: normalizedEmail });
  } catch (error) {
    console.error("[request-company-signup] notifyPlatformAdmins unexpected failure:", error instanceof Error ? error.message : error);
  }

  res.status(200).json({ submitted: true });
}

async function notifyPlatformAdmins({ supabaseUrl, serviceRoleKey, requestId, companyName, requesterName, requesterEmail }) {
  const adminRowsResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/get_platform_admin_emails`, {
    method: "POST",
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!adminRowsResponse.ok) {
    await recordSystemHealthEventServerSide({
      surface: "company_signup_notification",
      entityType: "company_signup_request",
      entityId: typeof requestId === "string" ? requestId : null,
      failureReasonCode: "platform_admin_email_lookup_failed",
      severity: "degraded",
      safeDetail: { status: adminRowsResponse.status },
    });
    return;
  }

  const adminRows = await adminRowsResponse.json();
  const adminEmails = Array.isArray(adminRows) ? adminRows.map((row) => row.email).filter(Boolean) : [];
  if (adminEmails.length === 0) {
    return;
  }

  const title = "New company signup request";
  const body = `${requesterName} (${requesterEmail}) requested a new company account for "${companyName}". Review it in Ergon Platform -> Company Signup Requests.`;

  for (const email of adminEmails) {
    await fetch(`${supabaseUrl}/rest/v1/notifications`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
        prefer: "return=minimal,resolution=ignore-duplicates",
      },
      body: JSON.stringify({
        recipient_email: email,
        event_type: "company_signup_requested",
        title,
        body,
        related_entity_type: "company_signup_request",
        related_entity_id: requestId,
        dedupe_key: `company_signup_requested:${requestId}:${email.toLowerCase()}`,
      }),
    }).catch(() => undefined);
  }

  const emailResults = await Promise.all(
    adminEmails.map((email) =>
      sendEmail({
        to: email,
        subject: title,
        html: `<p>${body}</p>`,
        fromName: "Ergon Ops",
      }),
    ),
  );

  const failures = emailResults.filter((result) => !result.sent);
  if (failures.length > 0) {
    await recordSystemHealthEventServerSide({
      surface: "company_signup_notification",
      entityType: "company_signup_request",
      entityId: typeof requestId === "string" ? requestId : null,
      failureReasonCode: "email_send_failed",
      severity: "degraded",
      safeDetail: { failedCount: failures.length, totalRecipients: adminEmails.length, reasons: failures.map((f) => f.error || f.reason || "unknown") },
    });
  }
}
