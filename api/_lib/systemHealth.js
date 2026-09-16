// Shared server-side helper for System Health Phase B (migration 151,
// PRODUCT_SYSTEM_HEALTH_PLAN.md). Used by any Vercel serverless function
// that has no signed-in user session of its own (cron jobs, rate-limit
// checks) -- calls record_system_health_event via the service-role key,
// matching this app's existing service-role REST pattern (e.g.
// api/cron/task-overdue.js's own insertNotification helper). Never
// throws to its caller, per the design doc's §10 rule -- a health-event
// logging failure must never affect the real operation that triggered it.
export async function recordSystemHealthEventServerSide(params) {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return;
  }
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/record_system_health_event`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_surface: params.surface,
        p_entity_type: params.entityType ?? null,
        p_entity_id: params.entityId ?? null,
        p_failure_reason_code: params.failureReasonCode,
        p_severity: params.severity,
        p_safe_detail: params.safeDetail ?? null,
        p_workspace_id: null,
      }),
    });
    if (!response.ok) {
      console.error(`[systemHealth] record_system_health_event failed for surface "${params.surface}": HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`[systemHealth] record_system_health_event unexpected failure for surface "${params.surface}":`, error instanceof Error ? error.message : error);
  }
}
