// Proposal acceptance (D12 revised, approved 2026-09-16; migration 153).
// The browser used to call respond_to_quote_proposal directly via the
// anon PostgREST endpoint, hardcoding approver_ip: "" -- a Postgres
// function has no reliable way to observe the real HTTP client's IP on
// its own through PostgREST. This route is the fix: it reads the real
// client IP from Vercel's own req.headers['x-forwarded-for'] (the
// standard, already-trustworthy source Vercel's edge sets on every
// request) and calls the RPC via the service-role key. anon's direct
// execute grant on the function is revoked in the same migration that
// ships this route (matching D4/migration 147's own close+switch-
// together precedent) -- this app's own bundled frontend is the only
// real consumer of that grant, so there's no external integration to
// break by closing it.
//
// Deliberately NOT behind requireAuth -- the person completing this
// flow is an external client with no Ergon login; the share token
// itself (validated inside the RPC, same as before) is the real access
// control, unchanged from the direct-RPC-call era. Rate-limited by IP
// instead, since there's no signed-in user id to key on.
import { checkRateLimit } from "./_lib/rateLimit.js";

const ALLOWED_STATUSES = ["approved", "rejected", "revision_requested"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ outcome: "error" });
    return;
  }

  const clientIp = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "";

  if (!(await checkRateLimit(`respond-to-proposal:${clientIp || "unknown"}`, 20, 60_000))) {
    res.status(429).json({ outcome: "error", error: "Too many requests -- please slow down." });
    return;
  }

  const { shareToken, newStatus, approverName, notes, selectedOptionalLineIds } = req.body || {};
  if (typeof shareToken !== "string" || !shareToken) {
    res.status(400).json({ outcome: "error", error: "shareToken is required." });
    return;
  }
  if (!ALLOWED_STATUSES.includes(newStatus)) {
    res.status(400).json({ outcome: "error", error: "Invalid proposal response status." });
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(200).json([{ outcome: "error" }]);
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/respond_to_quote_proposal`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        share_token: shareToken,
        new_status: newStatus,
        approver_name: approverName || "Unknown",
        approver_ip: clientIp,
        notes: notes || "",
        p_selected_optional_line_ids: Array.isArray(selectedOptionalLineIds) ? selectedOptionalLineIds : [],
      }),
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      console.error(`[respond-to-proposal] RPC failed: HTTP ${response.status}: ${bodyText}`);
      res.status(200).json([{ outcome: "error" }]);
      return;
    }
    const rows = await response.json();
    res.status(200).json(rows);
  } catch (error) {
    console.error("[respond-to-proposal] Unexpected failure:", error instanceof Error ? error.message : error);
    res.status(200).json([{ outcome: "error" }]);
  }
}
