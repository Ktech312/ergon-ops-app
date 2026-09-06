// Slack/Teams delivery for the notification engine (migration 024's
// notification_rules "Slack / Teams" channel), now with two possible
// mechanisms:
//
//   1. Per-person Slack DM (preferred, when configured) -- uses a real
//      Slack Bot Token to post directly to one person's Slack DM via
//      chat.postMessage. Needs the caller to resolve the recipient's
//      Slack member ID first (team_members.slack_user_id, migration 099)
//      and send it as `slackUserId`; the client does this by matching
//      recipientEmail against the already-loaded team_members list.
//   2. Shared-channel webhook (fallback, original behavior) -- posts a
//      plain { text } payload to one fixed channel. Used when there's no
//      bot token yet, or the recipient has no Slack ID on file.
//
// Same honest-fallback pattern as the other notification endpoints: if
// neither is configured, responds { sent: false, reason: ... } instead of
// pretending. Microsoft Teams classic-connector webhooks also accept the
// same { text } payload shape, so the webhook fallback still doubles as
// Teams support -- the bot-token DM path is Slack-only.
//
// To actually send a per-person Slack DM, add these Vercel project env
// vars (from a real Slack App -- see HANDOFF.md for the setup steps):
//   SLACK_BOT_TOKEN - a Bot User OAuth Token (xoxb-...) with chat:write
// To use the shared-channel fallback instead/as well:
//   SLACK_WEBHOOK_URL - an incoming webhook URL from Slack or Teams

import { requireAuth } from "./_lib/requireAuth.js";

// Security review, 2026-09-06 -- `slackUserId` used to go straight to
// Slack's chat.postMessage `channel` param with no check at all: any
// signed-in user could DM (or post into) any Slack channel/user the
// bot can reach, with arbitrary content, not just a real Ergon
// teammate's own DM. Now it must match a real team_members.slack_user_id
// on file (migration 099), queried with the caller's own access token.
async function isKnownSlackId(slackUserId, accessToken) {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return false;
  }
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/team_members?slack_user_id=eq.${encodeURIComponent(slackUserId)}&select=id`,
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
    res.status(405).json({ error: "Use POST to send a Slack/Teams notification." });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const { title, body, slackUserId } = req.body || {};

  if (!title || typeof title !== "string" || title.length > 300) {
    res.status(400).json({ sent: false, error: "title is required and must be reasonably short." });
    return;
  }
  if (typeof body === "string" && body.length > 10000) {
    res.status(400).json({ sent: false, error: "body is too long." });
    return;
  }

  const botToken = process.env.SLACK_BOT_TOKEN;
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (botToken && slackUserId) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!(await isKnownSlackId(slackUserId, token))) {
      res.status(403).json({ sent: false, error: "That Slack ID isn't on file for a real Ergon teammate." });
      return;
    }
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
