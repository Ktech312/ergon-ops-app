// Shared server-side helper for System Health Phase B (migrations 151,
// 152, PRODUCT_SYSTEM_HEALTH_PLAN.md). Used by any Vercel serverless
// function that has no signed-in user session of its own (cron jobs,
// rate-limit checks) -- calls record_system_health_event/
// record_system_health_recovery via the service-role key, matching this
// app's existing service-role REST pattern (e.g. api/cron/task-overdue.js's
// own insertNotification helper). Never throws to its caller, per the
// design doc's §10 rule -- a health-event logging failure must never
// affect the real operation that triggered it.
//
// Unlike the browser-side wrapper (persistence.ts's recordSystemHealthEvent,
// which posts to api/send-system-health-alert.js when alert-worthy),
// this helper sends the alert/recovery email directly via sendEmail --
// it already runs in the same Node process as api/_lib/mailer.js, so
// there's no reason to add an extra HTTP hop to another serverless
// function just to reach code already available locally.
import { sendEmail } from "./mailer.js";

async function callHealthRpc(fnName, body) {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error(`[systemHealth] ${fnName} failed: HTTP ${response.status}`);
    return null;
  }
  return response.json();
}

async function sendHealthEmail(kind, params, adminEmails) {
  if (!Array.isArray(adminEmails) || adminEmails.length === 0) {
    return;
  }
  const subject =
    kind === "alert"
      ? `System Health: ${params.surface} is DOWN (${params.failureReasonCode})`
      : `System Health: ${params.surface} recovered (${params.failureReasonCode})`;
  const body =
    kind === "alert"
      ? `<p>A repeated failure has crossed the alert threshold (3+ consecutive occurrences, spanning at least 5 minutes, no successful event in between).</p>
         <p><strong>Surface:</strong> ${params.surface}<br/><strong>Reason:</strong> ${params.failureReasonCode}<br/><strong>Severity:</strong> ${params.severity || "n/a"}</p>
         <p>Check the System Health -- Events panel in Ergon Ops (Admin page) for full detail.</p>`
      : `<p>The following System Health incident has recovered -- a successful event was recorded for the same surface/reason.</p>
         <p><strong>Surface:</strong> ${params.surface}<br/><strong>Reason:</strong> ${params.failureReasonCode}</p>`;
  for (const email of adminEmails) {
    await sendEmail({ to: email, subject, html: body, fromName: "Ergon Ops System Health" }).catch(() => {});
  }
}

export async function recordSystemHealthEventServerSide(params) {
  try {
    const result = await callHealthRpc("record_system_health_event", {
      p_surface: params.surface,
      p_entity_type: params.entityType ?? null,
      p_entity_id: params.entityId ?? null,
      p_failure_reason_code: params.failureReasonCode,
      p_severity: params.severity,
      p_safe_detail: params.safeDetail ?? null,
      p_workspace_id: null,
    });
    if (result && result.alert_worthy) {
      await sendHealthEmail("alert", params, result.admin_emails);
    }
  } catch (error) {
    console.error(`[systemHealth] record_system_health_event unexpected failure for surface "${params.surface}":`, error instanceof Error ? error.message : error);
  }
}

// Called on a SUCCESSFUL event for a key that may have a live
// active/acknowledged row -- resolves it and, if an alert had actually
// fired for it, sends a recovery notice. A no-op (no email) when there
// was nothing to recover from.
export async function recordSystemHealthRecoveryServerSide(params) {
  try {
    const result = await callHealthRpc("record_system_health_recovery", {
      p_surface: params.surface,
      p_entity_type: params.entityType ?? null,
      p_entity_id: params.entityId ?? null,
      p_failure_reason_code: params.failureReasonCode,
    });
    if (result && result.recovered && result.was_alerted) {
      await sendHealthEmail("recovery", params, result.admin_emails);
    }
  } catch (error) {
    console.error(`[systemHealth] record_system_health_recovery unexpected failure for surface "${params.surface}":`, error instanceof Error ? error.message : error);
  }
}
