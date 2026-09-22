// Consolidated notification-delivery dispatcher -- Vercel Hobby plan
// caps a deployment at 12 serverless functions (every api/*.js file
// except the underscore-prefixed api/_lib/ helpers counts); this app
// was already at that cap before migration 190's forward-attachment.js
// tipped it over. Merges four previously separate routes
// (send-notification-email.js, send-notification-slack.js,
// send-push.js, send-system-health-alert.js) into one file, dispatched
// on `req.body.channel`. This is a pure file-consolidation refactor --
// every branch below is that route's own handler body, carried forward
// UNCHANGED (same validation, same auth/role/rate-limit checks, same
// rate-limit KEY STRINGS -- System Health's own rate-limit surface
// breakdown is keyed by the string before the first ":", so changing
// these would silently reshape existing System Health history --, same
// response shapes, same status codes). See HANDOFF.md's "URGENT" entry
// (2026-09-21) for the full incident this fixes.

import webpush from "web-push";
import { requireAuth } from "./_lib/requireAuth.js";
import { isAllowedAppUrl } from "./_lib/validateUrl.js";
import { loadNotificationById, hasExistingDelivery } from "./_lib/notificationLookup.js";
import { checkRateLimit } from "./_lib/rateLimit.js";
import { resolveDirectMessage } from "./_lib/directMessage.js";
import { sendEmail } from "./_lib/mailer.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send a notification." });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const { channel } = req.body || {};
  if (channel === "email") {
    await handleEmail(req, res, user);
    return;
  }
  if (channel === "slack") {
    await handleSlack(req, res, user);
    return;
  }
  if (channel === "push") {
    await handlePush(req, res, user);
    return;
  }
  if (channel === "system-health") {
    await handleSystemHealth(req, res, user);
    return;
  }
  res.status(400).json({ sent: false, error: "channel must be one of: email, slack, push, system-health." });
}

// ============================================================
// channel: "email" -- formerly api/send-notification-email.js, verbatim.
// ============================================================

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

async function handleEmail(req, res, user) {
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

// ============================================================
// channel: "slack" -- formerly api/send-notification-slack.js, verbatim.
// ============================================================

async function slackUserIdForEmail(email, supabaseUrl, serviceRoleKey) {
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/team_members?email=ilike.${encodeURIComponent(email)}&select=slack_user_id`,
      { headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` } },
    );
    if (!response.ok) {
      return null;
    }
    const rows = await response.json();
    return rows[0]?.slack_user_id || null;
  } catch {
    return null;
  }
}

async function handleSlack(req, res, user) {
  if (!(await checkRateLimit(`notification-slack:${user.id}`, 30, 60_000))) {
    res.status(429).json({ sent: false, error: "Too many Slack notifications sent -- please slow down." });
    return;
  }

  const { notificationId } = req.body || {};
  if (!notificationId || typeof notificationId !== "string") {
    res.status(400).json({ sent: false, error: "notificationId is required." });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(200).json({ sent: false, reason: "Slack/Teams delivery isn't fully configured yet." });
    return;
  }

  const notification = await loadNotificationById(notificationId, supabaseUrl, serviceRoleKey);
  if (!notification) {
    res.status(404).json({ sent: false, error: "That notification doesn't exist." });
    return;
  }
  if (typeof notification.title !== "string" || notification.title.length > 300 || (typeof notification.body === "string" && notification.body.length > 10000)) {
    res.status(400).json({ sent: false, error: "That notification's title or body is too long to post." });
    return;
  }
  if (await hasExistingDelivery(notificationId, "slack", supabaseUrl, serviceRoleKey)) {
    res.status(200).json({ sent: false, reason: "Already delivered." });
    return;
  }

  const { title, body } = notification;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const slackUserId = botToken ? await slackUserIdForEmail(notification.recipient_email, supabaseUrl, serviceRoleKey) : null;

  if (botToken && slackUserId) {
    try {
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify({ channel: slackUserId, text: body ? `*${title}*\n${body}` : title }),
      });
      const result = await response.json();
      // Slack's Web API always returns HTTP 200 -- success/failure is in
      // the JSON body's `ok` field, not the status code.
      if (!result.ok) {
        res.status(502).json({ sent: false, error: `Slack API error: ${result.error || "unknown"}` });
        return;
      }
      res.status(200).json({ sent: true, via: "bot_dm" });
      return;
    } catch (error) {
      res.status(500).json({ sent: false, error: error instanceof Error ? error.message : "Could not DM via Slack." });
      return;
    }
  }

  if (!webhookUrl) {
    res.status(200).json({
      sent: false,
      reason: botToken
        ? "Slack bot token is set, but this person has no Slack member ID on file yet (Admin > Team Roster), and no SLACK_WEBHOOK_URL fallback is set either."
        : "Slack/Teams delivery isn't configured yet (neither SLACK_BOT_TOKEN nor SLACK_WEBHOOK_URL is set in Vercel), so nothing was posted.",
    });
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: body ? `*${title}*\n${body}` : title }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      res.status(502).json({ sent: false, error: `Webhook returned ${response.status}: ${errorBody}` });
      return;
    }

    res.status(200).json({ sent: true, via: "webhook" });
  } catch (error) {
    res.status(500).json({ sent: false, error: error instanceof Error ? error.message : "Could not post to Slack/Teams." });
  }
}

// ============================================================
// channel: "push" -- formerly api/send-push.js, verbatim.
// ============================================================

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
  const url = `/#messages/${resolved.conversationId}`;
  return { recipientId: resolved.recipientId, title, body, url };
}

async function handlePush(req, res, user) {
  if (!(await checkRateLimit(`push:${user.id}`, 40, 60_000))) {
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

// ============================================================
// channel: "system-health" -- formerly api/send-system-health-alert.js,
// verbatim.
// ============================================================

async function handleSystemHealth(req, res, user) {
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
      console.error(`[send-notification:system-health] list_admin_emails failed: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error("[send-notification:system-health] Could not load admin emails:", error instanceof Error ? error.message : error);
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

  console.log(`[send-notification:system-health] kind=${kind} surface=${surface} reason=${failureReasonCode} sent=${sentCount}/${adminEmails.length}`);
  res.status(200).json({ sent: sentCount > 0, sentCount, recipientCount: adminEmails.length, safeDetail: safeDetail ?? null });
}
