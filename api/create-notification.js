// The ONLY trusted way to create a `notifications` row (HANDOFF
// Questions/Decisions #9, closed 2026-09-08). Until this route existed,
// `main.tsx`'s notify() wrote directly to `notifications` using the
// caller's own access token, protected only by an INSERT policy of
// `with check (true)` -- any signed-in user could address a notification
// to anyone, with any event_type/title/body. The 2026-09-07 pass already
// stopped the *delivery* routes (send-push/-email/-slack) from trusting
// anything but the stored row -- this route closes the other half: the
// row itself can no longer be fabricated, because this is now the only
// path that can write one, and every event type independently re-derives
// its recipient(s) and content from real data instead of trusting the
// request body for either. See api/_lib/notificationEvents.js for the
// per-event-type authorization/derivation logic, and
// backend/supabase/migrations/114_trusted_notification_creation.sql for
// the RLS change that makes this the ONLY path (run once this route has
// been live and confirmed working -- see that file's own header).
//
// Request body: { eventType, relatedEntityId, relatedEntityType?, stage? }
// -- relatedEntityType is only read for "mentioned" (task/channel_message/
// canvas, to know what kind of row relatedEntityId points at); stage is
// only read for "build_stage_changed" (one of a fixed enum). No
// recipient, title, body, or url is ever accepted here.
//
// direct_message_received is handled as its own mode, `{ directMessageId }`,
// mirroring api/send-push.js's identical pattern -- see api/_lib/directMessage.js.

import { requireAuth } from "./_lib/requireAuth.js";
import { checkRateLimit } from "./_lib/rateLimit.js";
import { resolveDirectMessage } from "./_lib/directMessage.js";
import { runNotificationEvent, SUPPORTED_EVENT_TYPES } from "./_lib/notificationEvents.js";

const MAX_TITLE_LENGTH = 300;
const MAX_BODY_LENGTH = 10000;

async function insertNotification(supabaseUrl, serviceRoleKey, row) {
  const response = await fetch(`${supabaseUrl}/rest/v1/notifications`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      prefer: "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify(row),
  });
  if (!response.ok) {
    return null;
  }
  const rows = await response.json();
  return rows[0] || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to create a notification." });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }
  if (!checkRateLimit(`create-notification:${user.id}`, 60, 60_000)) {
    res.status(429).json({ error: "Too many notification-creation requests -- please slow down." });
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    res.status(200).json({ created: [], reason: "Not configured." });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const { directMessageId, eventType, relatedEntityId, relatedEntityType, stage } = req.body || {};

  let result;
  let resolvedEventType;

  if (directMessageId) {
    if (typeof directMessageId !== "string") {
      res.status(400).json({ error: "directMessageId must be a string." });
      return;
    }
    const resolved = await resolveDirectMessage(req, user, directMessageId, supabaseUrl, anonKey);
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }
    resolvedEventType = "direct_message_received";
    result = {
      relatedEntityType: "conversation",
      title: `New message from ${resolved.senderEmail}`,
      body: (resolved.body || (resolved.attachmentFileName ? `Sent a file: ${resolved.attachmentFileName}` : "")).slice(0, 200),
      // A recipient id, not an email -- resolve it below. Deliberately no
      // dedupeExtra: every real message is its own notification.
      recipientIds: [resolved.recipientId],
    };
  } else {
    if (typeof eventType !== "string" || !SUPPORTED_EVENT_TYPES.includes(eventType)) {
      res.status(400).json({ error: `Unsupported event type. Must be one of: ${SUPPORTED_EVENT_TYPES.join(", ")}` });
      return;
    }
    if (typeof relatedEntityId !== "string" || !relatedEntityId) {
      res.status(400).json({ error: "relatedEntityId is required." });
      return;
    }
    resolvedEventType = eventType;
    const outcome = await runNotificationEvent(eventType, {
      user,
      callerToken,
      supabaseUrl,
      anonKey,
      serviceRoleKey,
      relatedEntityId,
      relatedEntityType: typeof relatedEntityType === "string" ? relatedEntityType : undefined,
      stage: typeof stage === "string" ? stage : undefined,
    });
    if (outcome.error) {
      res.status(outcome.error.status).json({ error: outcome.error.message });
      return;
    }
    result = outcome;
  }

  if (result.title && result.title.length > MAX_TITLE_LENGTH) {
    result.title = result.title.slice(0, MAX_TITLE_LENGTH);
  }
  if (result.body && result.body.length > MAX_BODY_LENGTH) {
    result.body = result.body.slice(0, MAX_BODY_LENGTH);
  }

  // Resolve recipientIds (direct-message mode) to real emails via the
  // known-users directory -- same trust boundary every other route uses.
  let recipientEmails = result.recipients || [];
  if (result.recipientIds) {
    const rows = await Promise.all(
      result.recipientIds.map(async (id) => {
        try {
          const r = await fetch(`${supabaseUrl}/rest/v1/app_known_users?user_id=eq.${encodeURIComponent(id)}&select=email`, {
            headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
          });
          if (!r.ok) return null;
          const data = await r.json();
          return data[0]?.email || null;
        } catch {
          return null;
        }
      }),
    );
    recipientEmails = rows.filter(Boolean);
  }

  const created = [];
  for (const email of recipientEmails) {
    const dedupeKey = `${resolvedEventType}:${relatedEntityId || directMessageId}:${email.toLowerCase()}${result.dedupeExtra ? `:${result.dedupeExtra}` : ""}`;
    const row = await insertNotification(supabaseUrl, serviceRoleKey, {
      recipient_email: email,
      event_type: resolvedEventType,
      title: result.title,
      body: result.body,
      related_entity_type: result.relatedEntityType,
      related_entity_id: relatedEntityId || directMessageId,
      dedupe_key: dedupeKey,
      // created_by intentionally omitted: migration 114 (which adds that
      // column) is meant to be run AFTER this route is deployed and
      // confirmed working, not before -- inserting an unknown column
      // would 400 against the current (pre-114) schema. Add
      // `created_by: user.id` back in as a trivial one-line follow-up
      // once E confirms 114 has run; see HANDOFF.md.
    });
    if (row) {
      created.push({ id: row.id, recipientEmail: email });
    }
  }

  res.status(200).json({ created });
}
