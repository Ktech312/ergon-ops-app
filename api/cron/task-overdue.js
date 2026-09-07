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
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
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
      res.status(502).json({ error: "Could not load overdue tasks." });
      return;
    }
    tasks = await response.json();
  } catch (error) {
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

  res.status(200).json({ scanned: tasks.length, created });
}
