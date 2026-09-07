// Security review, 2026-09-07 -- send-notification-email/slack/push used
// to accept a fully client-supplied recipient/title/body (only the
// recipient was checked against a known-user directory; content was
// trusted as-is). That meant a caller could write one thing to the
// `notifications` table (the audit trail / in-app bell) and push/email/
// Slack something completely different through the same request --
// two independently-trusted payloads for what's supposed to be one event.
//
// Fix: main.tsx's notify() still writes the `notifications` row first
// (unchanged), but now the three delivery routes take only a
// `notificationId` and load the row THEMSELVES via the service-role key
// (notifications' own RLS restricts SELECT to the recipient or an admin,
// which the calling user usually isn't -- e.g. the person who assigned a
// task isn't the assignee) -- so delivery always reflects exactly what
// was recorded, not a second caller-supplied payload. `notifications`
// itself still has no per-row sender/relationship check (its INSERT
// policy is `with check (true)`, unchanged by this pass -- see
// HANDOFF.md's Questions/Decisions Needed for why that's a deliberately
// separate, larger schema change, not folded into this one), so this
// does not by itself stop a signed-in user from writing a fabricated
// notification addressed to another real user -- it stops the *delivery
// channel* from ever diverging from what's on record, and every
// delivery route still separately re-validates the recipient is a real
// known Ergon user before sending anything.
export async function loadNotificationById(notificationId, supabaseUrl, serviceRoleKey) {
  if (!notificationId || typeof notificationId !== "string") {
    return null;
  }
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/notifications?id=eq.${encodeURIComponent(notificationId)}&select=id,recipient_email,event_type,title,body,related_entity_type,related_entity_id`,
      { headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` } },
    );
    if (!response.ok) {
      return null;
    }
    const rows = await response.json();
    return rows[0] || null;
  } catch {
    return null;
  }
}

// Best-effort replay guard, not a hard uniqueness constraint (no unique
// index on notification_deliveries(notification_id, channel) -- adding
// one is a real follow-up, not done here to avoid another migration in
// this same pass). Checked before sending so a notificationId can't be
// trivially replayed to re-spam the same person through the same
// channel; a tight double-fire race is still possible since this is a
// check-then-act, not atomic -- acceptable for blunting casual replay,
// not a substitute for a real uniqueness constraint if that's wanted
// later.
export async function hasExistingDelivery(notificationId, channel, supabaseUrl, serviceRoleKey) {
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/notification_deliveries?notification_id=eq.${encodeURIComponent(notificationId)}&channel=eq.${encodeURIComponent(channel)}&status=eq.sent&select=id&limit=1`,
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
