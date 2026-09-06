// Security review, 2026-09-06 -- send-invite-email/send-proposal-email/
// send-submittal-email all took a fully caller-controlled URL and
// emailed it out as a clickable link, using this app's own trusted
// sender identity. Nothing stopped a caller from pointing that link at
// an attacker-controlled site -- a phishing link riding on Ergon's own
// mail reputation, sent to a real client or new hire. This only allows
// links back to this app's own deployment (production, this preview's
// own VERCEL_URL, or localhost for local testing) -- everything else
// is rejected before an email ever goes out.

const STATIC_ALLOWED_HOSTS = ["ergon-ops-app.vercel.app", "localhost", "127.0.0.1"];

export function isAllowedAppUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return false;
  }
  const allowedHosts = [...STATIC_ALLOWED_HOSTS];
  if (process.env.VERCEL_URL) {
    allowedHosts.push(process.env.VERCEL_URL.replace(/^https?:\/\//, ""));
  }
  return allowedHosts.includes(parsed.hostname);
}
