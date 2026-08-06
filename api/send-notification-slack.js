// Generic Slack/Teams webhook delivery for the notification engine
// (migration 024's notification_rules "Slack / Teams" channel). Same
// honest-fallback pattern as the email endpoints: if no webhook URL is set,
// responds { sent: false, reason: ... } instead of pretending.
//
// Posts a plain { text } payload -- this is Slack's incoming-webhook format
// and is also accepted by classic Microsoft Teams "Connectors" webhooks.
// Newer Teams "Workflows" webhooks (Power Automate) expect a different
// schema; if that's what you're using, this will need a small adjustment
// once you share the webhook so the payload can be matched to it.
//
// To actually send, add this Vercel project env var:
//   SLACK_WEBHOOK_URL - an incoming webhook URL from Slack or Teams

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to send a Slack/Teams notification." });
    return;
  }

  const { title, body } = req.body || {};

  if (!title) {
    res.status(400).json({ sent: false, error: "title is required." });
    return;
  }

  if (!process.env.SLACK_WEBHOOK_URL) {
    res.status(200).json({
      sent: false,
      reason: "Slack/Teams delivery isn't configured yet (SLACK_WEBHOOK_URL is not set in Vercel), so nothing was posted.",
    });
    return;
  }

  try {
    const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: body ? `*${title}*\n${body}` : title }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      res.status(502).json({ sent: false, error: `Webhook returned ${response.status}: ${errorBody}` });
      return;
    }

    res.status(200).json({ sent: true });
  } catch (error) {
    res.status(500).json({ sent: false, error: error instanceof Error ? error.message : "Could not post to Slack/Teams." });
  }
}
