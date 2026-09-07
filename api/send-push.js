// Web Push delivery (migration 095) -- second half of E's "direct message
// and alert system" request. Same honest-fallback pattern as the email/
// Slack endpoints: if VAPID keys or the service-role key aren't set,
// responds { sent: false, reason: ... } instead of pretending.
//
// This is the one server route in this app that talks to Supabase
// directly with elevated access -- looking up *another* user's push
// subscriptions has to bypass RLS (a browser session only ever manages
// its own subscription rows, see migration 095's policy), so this uses
// the Supabase service-role key instead of a user's own access token.
// Never expose SUPABASE_SERVICE_ROLE_KEY to client code (no VITE_ prefix,
// on purpose) -- only this server-side function should ever read it.
//
// To actually send, add these Vercel project env vars:
//   VAPID_PUBLIC_KEY        - same value as the client's VITE_VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY       - keep secret, server-only
//   SUPABASE_SERVICE_ROLE_KEY - from Supabase project settings -> API -> service_role
// (VITE_SUPABASE_URL is already set for the client build and is reused
// here as-is -- Vercel serverless functions can read any project env var
// regardless of its VITE_ prefix.)

import webpush from "web-push";
import { requireAuth } from "./_lib/requireAuth.js";
import { isAllowedAppUrl } from "./_lib/validateUrl.js";

// Security review, 2026-09-06 -- the most serious finding in this
// audit. This route uses the Supabase SERVICE-ROLE key to bypass RLS
// and push to ANY user's real device, and had no check on `userId` at
// all beyond "truthy" -- any signed-in account (including a brand-new,
// not-yet-approved one) could push fabricated title/body to any real
// teammate's phone. Fixed to require the target actually be a real
// signed-in Ergon user (app_known_users, checked with the CALLER'S OWN
// token so this validation step never uses elevated access), and caps
// content length. This still trusts "any real Ergon teammate can
// notify any other" the same way DMs/@mentions already do -- it closes
// the "arbitrary/fabricated recipient" hole, not internal messaging
// itself. See HANDOFF.md's Questions/Decisions Needed for the tighter
// "only through a validated application event" alternative if E wants
// that instead.
async function isKnownErgonUserId(userId, accessToken) {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return false;
  }
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/app_known_users?user_id=eq.${encodeURIComponent(userId)}&select=user_id`,
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
    res.status(405).json({ error: "Use POST to send a push notification." });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const { userId, title, body, url } = req.body || {};

  if (!userId || !title) {
    res.status(400).json({ sent: false, error: "userId and title are required." });
    return;
  }
  if (typeof title !== "string" || title.length > 200 || (typeof body === "string" && body.length > 2000)) {
    res.status(400).json({ sent: false, error: "title or body is too long." });
    return;
  }
  if (url && !isAllowedAppUrl(typeof url === "string" && url.startsWith("/") ? `https://${req.headers.host}${url}` : url)) {
    res.status(400).json({ sent: false, error: "url must point back to this app." });
    return;
  }
  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!(await isKnownErgonUserId(userId, callerToken))) {
    res.status(403).json({ sent: false, error: "That user isn't a real signed-in Ergon account." });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    res.status(200).json({
      sent: false,
      reason: "Push delivery isn't configured yet (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/SUPABASE_SERVICE_ROLE_KEY not all set in Vercel), so nothing was sent.",
    });
    return;
  }

  webpush.setVapidDetails("mailto:support@ensight-technologies.com", vapidPublicKey, vapidPrivateKey);

  try {
    const lookupResponse = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=id,endpoint,p256dh,auth_key`,
      { headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` } },
    );
    if (!lookupResponse.ok) {
      res.status(502).json({ sent: false, error: `Could not look up push subscriptions: ${lookupResponse.status}` });
      return;
    }
    const subscriptions = await lookupResponse.json();
    if (subscriptions.length === 0) {
      res.status(200).json({ sent: false, reason: "That user has no push subscriptions (hasn't turned on notifications on any device)." });
      return;
    }

    const payload = JSON.stringify({ title, body: body || "", url: url || "/" });
    let sentCount = 0;
    const deadSubscriptionIds = [];
    // Delivery-test finding, 2026-09-07: this used to only record 404/410
    // ("subscription gone") and silently drop every other failure --
    // exactly the same silent-failure shape this whole task started with,
    // just moved server-side. A wrong VAPID key pair, a malformed payload,
    // or FCM/browser push-service errors would all report success-shaped
    // {sent:false or true, count:N} with zero way to tell what actually
    // went wrong. Now every non-fatal send failure is captured with its
    // real status/message so a future "push isn't arriving" report is
    // debuggable from the response instead of a black box.
    const failures = [];

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            payload,
          );
          sentCount += 1;
        } catch (error) {
          // 404/410 means the browser/OS dropped this subscription (e.g.
          // uninstalled, permission revoked) -- clean it up so it stops
          // getting tried forever.
          if (error && (error.statusCode === 404 || error.statusCode === 410)) {
            deadSubscriptionIds.push(sub.id);
          }
          failures.push({
            subscriptionId: sub.id,
            statusCode: error && error.statusCode ? error.statusCode : null,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );

    if (deadSubscriptionIds.length > 0) {
      await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/push_subscriptions?id=in.(${deadSubscriptionIds.join(",")})`, {
        method: "DELETE",
        headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
      }).catch(() => {
        // Best-effort cleanup only -- a dead subscription that fails to
        // delete just gets retried (and skipped again) next time.
      });
    }

    res.status(200).json({ sent: sentCount > 0, count: sentCount, removed: deadSubscriptionIds.length, failures });
  } catch (error) {
    res.status(500).json({ sent: false, error: error instanceof Error ? error.message : "Could not send push notification." });
  }
}
