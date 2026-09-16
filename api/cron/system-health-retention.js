// System Health Phase B retention (migration 151, PRODUCT_SYSTEM_HEALTH_PLAN.md
// §6/§11 step 4): rolls resolved system_health_events rows older than 90
// days into the monthly summary tier via roll_up_system_health_events(),
// then deletes the rolled-up detail rows (done inside that one SQL
// function, not here, so it stays a single atomic operation). Matches
// api/cron/task-overdue.js's own pattern exactly -- Vercel Cron auth via
// CRON_SECRET, service-role key, no signed-in "actor" for a scheduled job.
//
// Runs weekly, not daily -- retention has no same-day urgency (a 90-day
// cutoff tolerates a few days' slack) and this keeps the schedule modest
// against any Vercel plan's cron-job limits now that a second cron entry
// exists alongside task-overdue. See vercel.json.
//
// §10's last bullet: the retention job's OWN failure is itself worth one
// system_health_events row, under its own surface = 'system_health_retention'
// -- the one place this table is allowed to monitor a job operating on
// itself, since a failed rollup (old detail rows never getting summarized)
// is an ordinary, recoverable operational failure, not the same
// unrecoverable meta-failure case as record_system_health_event's own
// write failing entirely.

import { recordSystemHealthEventServerSide, recordSystemHealthRecoveryServerSide } from "../_lib/systemHealth.js";

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[cron/system-health-retention] Not configured -- VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
    res.status(200).json({ rolledUp: 0, reason: "Not configured." });
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/roll_up_system_health_events`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      const message = `HTTP ${response.status}`;
      console.error(`[cron/system-health-retention] roll_up_system_health_events failed: ${message}`);
      await recordSystemHealthEventServerSide({
        surface: "system_health_retention",
        failureReasonCode: "retention_job_failed",
        severity: "degraded",
        safeDetail: { reason: message },
      });
      res.status(502).json({ error: "Retention rollup failed." });
      return;
    }
    const rolledUp = await response.json();
    console.log(`[cron/system-health-retention] rolledUp=${rolledUp}`);
    await recordSystemHealthRecoveryServerSide({ surface: "system_health_retention", failureReasonCode: "retention_job_failed" });
    res.status(200).json({ rolledUp });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    console.error("[cron/system-health-retention] Retention rollup failed:", message);
    await recordSystemHealthEventServerSide({
      surface: "system_health_retention",
      failureReasonCode: "retention_job_failed",
      severity: "degraded",
      safeDetail: { reason: message },
    });
    res.status(500).json({ error: message });
  }
}
