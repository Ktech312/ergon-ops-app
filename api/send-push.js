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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send a push notification." });
    return;
  }
  if (!(await requireAuth(req, res))) {
    return;
  }

  const { userId, title, body, url } = req.body || {};

  if (!userId || !title) {
    res.status(400).json({ sent: false, error: "userId and title are required." });
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
          // getting tried forever. Any other error is left alone; it
          // might be transient.
          if (error && (error.statusCode === 404 || error.statusCode === 410)) {
            deadSubscriptionIds.push(sub.id);
          }
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

    res.status(200).json({ sent: sentCount > 0, count: sentCount, removed: deadSubscriptionIds.length });
  } catch (error) {
    res.status(500).json({ sent: false, error: error instanceof Error ? error.message : "Could not send push notification." });
  }
}
