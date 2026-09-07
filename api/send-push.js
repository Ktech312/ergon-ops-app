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
//
// Security review, 2026-09-06 -- the most serious finding in that audit.
// This route used the service-role key to bypass RLS and push to ANY
// user's real device, with no check on `userId` beyond "truthy": any
// signed-in account (including a brand-new, not-yet-approved one) could
// push fabricated title/body to any real teammate's phone.
//
// Security review, 2026-09-07 -- closed the deeper gap: even after
// requiring a real recipient, the caller still supplied `title`/`body`/
// `url` directly, and for a DM push specifically, chose who to notify
// (a client-side lookup, never verified server-side). Now there are two
// modes, both of which derive the recipient and content from stored
// data instead of trusting the request body for either:
//
//   1. `{ directMessageId }` -- a real direct-message push. The message
//      row is read with the CALLER'S OWN access token (direct_messages'
//      own RLS -- migration 094 -- only lets a participant read it at
//      all), confirmed `sender_id === caller`, and the conversation's
//      OTHER participant becomes the recipient. The caller cannot name
//      an arbitrary recipient this way even in principle -- it's always
//      whoever is actually the other side of that specific message's
//      conversation.
//   2. `{ notificationId }` -- every other event type (task assigned,
//      mentioned, status changes, ...), routed through main.tsx's
//      notify()/createNotification() same as before. See
//      api/_lib/notificationLookup.js for why this reads the recipient/
//      title/body from the already-created `notifications` row via the
//      service-role key rather than trusting a second, independently
//      supplied payload in the same request.

import webpush from "web-push";
import { requireAuth } from "./_lib/requireAuth.js";
import { isAllowedAppUrl } from "./_lib/validateUrl.js";
import { loadNotificationById, hasExistingDelivery } from "./_lib/notificationLookup.js";
import { checkRateLimit } from "./_lib/rateLimit.js";
import { resolveDirectMessage } from "./_lib/directMessage.js";

async function userIdForKnownEmail(email, supabaseUrl, serviceRoleKey) {
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/app_known_users?email=ilike.${encodeURIComponent(email)}&select=user_id`,
      { headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` } },
    );
    if (!response.ok) {
      return null;
    }
    const rows = await response.json();
    return rows[0]?.user_id || null;
  } catch {
    return null;
  }
}

// Resolves a real direct-message push using the shared api/_lib/
// directMessage.js verification, then shapes it into the title/body/url
// this route sends. Returns null (with the response already written) on
// any failure.
async function resolveDirectMessagePush(req, res, user, directMessageId, supabaseUrl, anonKey) {
  const resolved = await resolveDirectMessage(req, user, directMessageId, supabaseUrl, anonKey);
  if (!resolved.ok) {
    res.status(resolved.status).json({ sent: false, error: resolved.error });
    return null;
  }
  const title = `New message from ${resolved.senderEmail}`;
  const body = (resolved.body || (resolved.attachmentFileName ? `Sent a file: ${resolved.attachmentFileName}` : "")).slice(0, 200);
  // HANDOFF Questions/Decisions item 12: deep-link straight into the real
  // conversation instead of the Messages hub's default view. The service
  // worker's notificationclick handler already navigates to whatever url
  // this payload names (public/sw.js) -- the only piece that was missing
  // was naming the conversation at all. Mirrors the existing
  // `#projects/<slug>` route pattern (main.tsx); the client-side route
  // effect that reads this segment lives in main.tsx next to
  // selectConversation().
  const url = `/#messages/${resolved.conversationId}`;
  return { recipientId: resolved.recipientId, title, body, url };
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
  if (!checkRateLimit(`push:${user.id}`, 40, 60_000)) {
    res.status(429).json({ sent: false, error: "Too many push notifications sent -- please slow down." });
    return;
  }

  const { directMessageId, notificationId, url: rawUrl } = req.body || {};
  if (!directMessageId && !notificationId) {
    res.status(400).json({ sent: false, error: "directMessageId or notificationId is required." });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    res.status(200).json({
      sent: false,
      reason: "Push delivery isn't configured yet (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/SUPABASE_SERVICE_ROLE_KEY not all set in Vercel), so nothing was sent.",
    });
    return;
  }

  let recipientId;
  let title;
  let body;
  let url;

  if (directMessageId) {
    if (typeof directMessageId !== "string") {
      res.status(400).json({ sent: false, error: "directMessageId must be a string." });
      return;
    }
    const resolved = await resolveDirectMessagePush(req, res, user, directMessageId, supabaseUrl, anonKey);
    if (!resolved) {
      return; // response already written
    }
    // No replay-guard lookup here (unlike the notificationId path below):
    // a direct message has no corresponding `notifications.id` to key a
    // notification_deliveries check on (that table's related_entity_id
    // for this event stores the conversation, not the message, and
    // notification_deliveries.notification_id has a real FK to
    // notifications.id -- there's nothing valid to check against). Each
    // real message send legitimately warrants exactly one push; the
    // per-caller rate limit above is this path's actual abuse guard.
    ({ recipientId, title, body, url } = resolved);
  } else {
    if (typeof notificationId !== "string") {
      res.status(400).json({ sent: false, error: "notificationId must be a string." });
      return;
    }
    const notification = await loadNotificationById(notificationId, supabaseUrl, serviceRoleKey);
    if (!notification) {
      res.status(404).json({ sent: false, error: "That notification doesn't exist." });
      return;
    }
    if (typeof notification.title !== "string" || notification.title.length > 200 || (typeof notification.body === "string" && notification.body.length > 2000)) {
      res.status(400).json({ sent: false, error: "That notification's title or body is too long to push." });
      return;
    }
    if (await hasExistingDelivery(notificationId, "push", supabaseUrl, serviceRoleKey)) {
      res.status(200).json({ sent: false, reason: "Already delivered." });
      return;
    }
    const knownRecipientId = await userIdForKnownEmail(notification.recipient_email, supabaseUrl, serviceRoleKey);
    if (!knownRecipientId) {
      res.status(200).json({ sent: false, reason: "Recipient has never signed into Ergon -- no push subscription possible." });
      return;
    }
    recipientId = knownRecipientId;
    title = notification.title;
    body = notification.body || "";
    url =
      notification.related_entity_type === "task"
        ? "/#tasks"
        : notification.related_entity_type === "channel_message" || notification.related_entity_type === "canvas" || notification.related_entity_type === "conversation"
          ? "/#messages"
          : "/#dashboard";
  }

  // rawUrl is accepted but only ever used as an already-validated
  // fallback -- both derivation paths above always produce a safe,
  // in-app url, so this is really just belt-and-suspenders against a
  // future code path that forgets to set one, not something a caller
  // can steer.
  if (!url && rawUrl) {
    const absolute = typeof rawUrl === "string" && rawUrl.startsWith("/") ? `https://${req.headers.host}${rawUrl}` : rawUrl;
    url = isAllowedAppUrl(absolute) ? rawUrl : "/dashboard";
  }
  url = url || "/dashboard";

  webpush.setVapidDetails("mailto:support@ensight-technologies.com", vapidPublicKey, vapidPrivateKey);

  try {
    const lookupResponse = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(recipientId)}&select=id,endpoint,p256dh,auth_key`,
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

    const payload = JSON.stringify({ title, body: body || "", url });
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
