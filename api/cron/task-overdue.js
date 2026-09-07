// task_overdue used to be a client-side useEffect (main.tsx) that ran in
// EVERY signed-in user's browser, scanning whatever tasks happened to be
// loaded and writing directly to `notifications` -- there was no "acting
// user" concept at all (any signed-in user's open tab could trigger a
// notification about any other user's overdue task, company-wide), and
// it depended on someone having the app open. Moved server-side
// (HANDOFF Questions/Decisions #9) as a real scheduled job instead:
// Vercel Cron hits this route once a day (see vercel.json), it scans
// every overdue task exactly once using the service-role key, and
// creates notifications through the same trusted per-recipient dedupe
// path as api/create-notification.js.
//
// Protected by CRON_SECRET (a Vercel project env var) rather than a
// user session -- there is no signed-in "actor" for a scheduled job.
// Vercel Cron automatically sends `authorization: Bearer $CRON_SECRET`
// when CRON_SECRET is set; reject anything else.

const TASK_STATUS_LABEL_DONE = "done";

// Every console.error below logs only the task id and an HTTP status/
// error message -- never req.headers, the Authorization header, or
// process.env.CRON_SECRET itself. Keep it that way if this function is
// ever touched again.
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
    // Live-verified 2026-09-08: a retried run against an already-notified
    // task genuinely 409s here -- `Prefer: resolution=ignore-duplicates`
    // only takes effect when the request also names its target via an
    // `on_conflict=<columns>` query param (PostgREST's documented
    // behavior); without one, a duplicate against idx_notifications_dedupe
    // (migration 024, a UNIQUE index but not the primary key) is a genuine
    // constraint violation, not a silent no-op. The dedupe guarantee still
    // holds either way -- the unique index itself is what blocks the
    // second row, this function just discards the failed insert instead of
    // PostgREST discarding it first -- so this is expected, routine
    // behavior on every retried event, not a failure worth alerting on.
    if (response.status === 409) {
      return null;
    }
    // A per-task insert failure used to be silently dropped -- it just
    // wasn't counted, with nothing in Vercel's function logs to explain
    // why a given assignee never got their overdue notification. Now at
    // least visible for whoever next checks the logs (task id + status
    // only -- the row itself already excludes anything secret).
    console.error(`[cron/task-overdue] Failed to insert notification for task ${row.related_entity_id}: HTTP ${response.status}`);
    return null;
  }
  const rows = await response.json();
  return rows[0] || null;
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    // Deliberately no console.error here: a missing/wrong secret is
    // routine, expected traffic (a stray probe, or CRON_SECRET simply
    // not configured yet) -- logging every rejected attempt would be
    // noise, not signal, and there is no safe way to log "what was sent"
    // without risking the secret itself ending up in the log. The 401
    // response is the correct, sufficient signal for this case.
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[cron/task-overdue] Not configured -- VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
    res.status(200).json({ created: 0, reason: "Not configured." });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` };

  let tasks;
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/tasks?status=neq.${TASK_STATUS_LABEL_DONE}&due_date=lt.${today}&assignee_email=not.is.null&deleted_at=is.null&select=id,title,due_date,assignee_email`,
      { headers },
    );
    if (!response.ok) {
      console.error(`[cron/task-overdue] Could not load overdue tasks: HTTP ${response.status}`);
      res.status(502).json({ error: "Could not load overdue tasks." });
      return;
    }
    tasks = await response.json();
  } catch (error) {
    console.error("[cron/task-overdue] Could not load overdue tasks:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not load overdue tasks." });
    return;
  }

  let created = 0;
  for (const task of tasks) {
    const row = await insertNotification(supabaseUrl, serviceRoleKey, {
      recipient_email: task.assignee_email,
      event_type: "task_overdue",
      title: "Task overdue",
      body: `"${task.title}" was due ${task.due_date}.`,
      related_entity_type: "task",
      related_entity_id: task.id,
      dedupe_key: `task_overdue:${task.id}:${task.assignee_email.toLowerCase()}:${today}`,
    });
    if (row) {
      created += 1;
    }
  }

  // One clean summary line per real run -- the only way to confirm from
  // Vercel's logs alone (without opening Supabase) that a given day's
  // cron actually scanned what it should have.
  console.log(`[cron/task-overdue] scanned=${tasks.length} created=${created}`);
  res.status(200).json({ scanned: tasks.length, created });
}
