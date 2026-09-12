// As of the Phase 10f cutover (Aug 2026), every entity that used to live in
// this JSON blob (inventoryItems, deviceRecipes, inventoryMovements,
// buildTransactions, projectAllocations, projectDocuments,
// purchaseRequests, projectSites) has its own real relational table, loaded
// and saved independently -- see loadInventoryItems/saveInventoryItems,
// loadDeviceRecipes/saveDeviceRecipes, saveMovementsBuildsAllocations,
// loadProjectDocuments/createProjectDocuments,
// loadPurchaseRequests/createPurchaseRequestRemote/updatePurchaseRequestRemote,
// and loadProjectSites/saveProjectSites. All that's left in the blob is
// roleMode, a single per-workspace UI preference.
export type PersistedAppState = {
  roleMode: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  userId: string;
  authFlow?: string;
};

// Client-side "PRJ-<year>-####" reference generator for the manual "add
// blank project" flow (main.tsx's nextProjectRef -- no server-side trigger
// or counter table backs this one, unlike sales_quotes.quote_ref). Fixed
// 2026-09-08: previously hardcoded the literal year 2026 in both the match
// pattern and the generated prefix, so it would have kept minting
// "PRJ-2026-####" refs forever after the calendar actually rolled over to
// 2027, instead of starting a fresh 0001 sequence for the new year the way
// the server-side quote_ref counter already does (migration 066's
// assign_sales_quote_ref(), keyed by extract(year from now())). Pulled out
// as a pure, exported function specifically so the year-boundary behavior
// is unit-testable without needing to render the Projects component.
export function computeNextProjectRef(existingRefs: string[], year: number): string {
  const yearPattern = new RegExp(`^PRJ-${year}-(\\d+)$`);
  const maxRef = existingRefs.reduce((currentMax, ref) => {
    const match = ref.match(yearPattern);
    return match ? Math.max(currentMax, Number(match[1])) : currentMax;
  }, 0);
  return `PRJ-${year}-${String(maxRef + 1).padStart(4, "0")}`;
}

const LOCAL_STATE_KEY = "ergon:app-state:v1";
const AUTH_SESSION_KEY = "ergon:auth-session:v1";
const WORKSPACE_KEY = "default";
const STATE_KEYS: Array<keyof PersistedAppState> = ["roleMode"];

function envValue(key: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY" | "VITE_VAPID_PUBLIC_KEY") {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.[key] ?? "";
}

export function isRemotePersistenceConfigured() {
  return Boolean(envValue("VITE_SUPABASE_URL") && envValue("VITE_SUPABASE_ANON_KEY"));
}

// VAPID public key for Web Push (migration 095) -- safe to expose to the
// client, that's what "public" means here; only VAPID_PRIVATE_KEY (server
// env, used by /api/send-push.js) needs to stay secret.
export function vapidPublicKey(): string {
  return envValue("VITE_VAPID_PUBLIC_KEY");
}

function supabaseHeaders(accessToken?: string) {
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
  return {
    apikey: anonKey,
    authorization: `Bearer ${accessToken || anonKey}`,
    "content-type": "application/json",
  };
}

function supabaseUrl(path: string) {
  return `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${path}`;
}

function supabaseAuthUrl(path: string) {
  return `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/auth/v1/${path}`;
}

// Migration 088 safety: every loader below adds a `deleted_at=is.null`
// (or embedded equivalent) filter for the new soft-delete columns. Until
// E runs 088 in Supabase, that column won't exist and the filtered query
// 400s -- this retries with the same URL minus the deleted_at filter(s) so
// the page still loads (just without soft-delete filtering) instead of
// going blank. `stripDeletedAtFilters` removes any `<path>deleted_at=...`
// query param from a URL string.
function stripDeletedAtFilters(url: string): string {
  return url
    .replace(/[&?][^&?=]*deleted_at=is\.null/g, "")
    .replace(/[&?][^&?=]*deleted_at=not\.is\.null/g, "");
}

async function fetchWithDeletedAtFallback(url: string, headers: Record<string, string>): Promise<Response> {
  const response = await fetch(url, { headers });
  if (!response.ok && response.status === 400) {
    const fallbackUrl = stripDeletedAtFilters(url);
    if (fallbackUrl !== url) {
      return fetch(fallbackUrl, { headers });
    }
  }
  return response;
}

async function readSupabaseError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as {
      error?: string;
      error_code?: string;
      error_description?: string;
      msg?: string;
      message?: string;
    };
    const detail = payload.error_description || payload.message || payload.msg || payload.error || payload.error_code;
    return detail ? `${fallback}: ${detail}` : `${fallback}: ${response.status}`;
  } catch {
    return `${fallback}: ${response.status}`;
  }
}

// Migration 088: a single shared audit trail for every soft-delete/restore
// across the app, instead of a bespoke activity log per entity (Tasks has
// its own richer per-task activity log already -- this is for everything
// else). Fire-and-forget: a failed log write should never block or roll
// back the delete/restore itself.
export type DeletionLogEntry = {
  id: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  action: "deleted" | "restored";
  actorEmail: string;
  createdAt: string;
};

type DeletionLogRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_label: string;
  action: string;
  actor_email: string | null;
  created_at: string;
};

function mapDeletionLogRow(row: DeletionLogRow): DeletionLogEntry {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    action: row.action === "restored" ? "restored" : "deleted",
    actorEmail: row.actor_email ?? "",
    createdAt: row.created_at,
  };
}

async function logDeletionEvent(
  entityType: string,
  entityId: string,
  entityLabel: string,
  action: "deleted" | "restored",
  actorEmail: string,
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  try {
    await fetch(supabaseUrl("deletion_log"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=minimal" },
      body: JSON.stringify({ entity_type: entityType, entity_id: entityId, entity_label: entityLabel, action, actor_email: actorEmail || null }),
    });
  } catch {
    // Never let a logging failure block the actual delete/restore.
  }
}

export async function loadDeletionLog(accessToken?: string): Promise<DeletionLogEntry[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl("deletion_log?select=*&order=created_at.desc&limit=500"), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as DeletionLogRow[];
  return rows.map(mapDeletionLogRow);
}

// System Health Phase A (2026-09-12, overnight reliability closeout part
// 2, task 5): built entirely from the existing notification_deliveries/
// notifications tables (migration 024) -- no new migration, no new
// storage. Aggregates raw failed-delivery rows (one per attempt) into one
// row per distinct (channel, event type, failure reason), since an admin
// needs "this has failed 40 times since Tuesday," not 40 separate
// identical rows. This is deliberately the SAME shape
// PRODUCT_SYSTEM_HEALTH_PLAN.md's dedup key describes (surface/entity/
// reason), scoped down to what this one existing table can already
// answer without a dedicated system_health_events table -- that fuller
// design remains future work, this is what today's schema supports.
export type NotificationDeliveryFailure = {
  channel: string;
  eventType: string;
  failureReason: string;
  occurrenceCount: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
  // A representative recipient from the most recent occurrence -- shown
  // as-is (this is an admin-only view; every admin screen in this app
  // already shows team member/user emails directly, e.g. Team Roster),
  // not masked further.
  lastRecipientEmail: string;
};

type NotificationDeliveryRow = {
  channel: string;
  error_message: string | null;
  sent_at: string;
  notification: { event_type: string; recipient_email: string } | null;
};

export async function loadNotificationDeliveryFailures(accessToken?: string): Promise<NotificationDeliveryFailure[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(
    supabaseUrl(
      "notification_deliveries?select=channel,error_message,sent_at,notification:notifications(event_type,recipient_email)&status=eq.failed&order=sent_at.desc&limit=1000",
    ),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as NotificationDeliveryRow[];
  const byKey = new Map<string, NotificationDeliveryFailure>();
  // Rows arrive newest-first (order=sent_at.desc) -- the first time a key
  // is seen it's the most recent occurrence (lastOccurredAt/
  // lastRecipientEmail); firstOccurredAt keeps shrinking as older rows
  // for the same key are found walking down the list.
  for (const row of rows) {
    const eventType = row.notification?.event_type ?? "unknown";
    const failureReason = row.error_message?.trim() || "No error detail recorded";
    const key = `${row.channel}::${eventType}::${failureReason}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        channel: row.channel,
        eventType,
        failureReason,
        occurrenceCount: 1,
        firstOccurredAt: row.sent_at,
        lastOccurredAt: row.sent_at,
        lastRecipientEmail: row.notification?.recipient_email ?? "",
      });
    } else {
      existing.occurrenceCount += 1;
      existing.firstOccurredAt = row.sent_at;
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.lastOccurredAt.localeCompare(a.lastOccurredAt));
}

// A one-off's aggregate qty is recomputed fresh from purchase-order receipts
// on every render (see `oneOffItems` in main.tsx) -- merging doesn't rename
// or delete anything, so without this record the same aggregate would just
// reappear at full quantity next render. Each row is "qty already merged
// into targetSku for this exact received-item name," subtracted back out of
// the live aggregate; if more of the same misnamed item arrives later, only
// the new unreconciled excess shows up again.
export type OneOffReconciliation = {
  id: string;
  itemKey: string;
  itemName: string;
  qty: number;
  targetSku: string;
  orderNumbers: string;
  resolvedByEmail: string;
  resolvedAt: string;
};

type OneOffReconciliationRow = {
  id: string;
  item_key: string;
  item_name: string;
  qty: number | string;
  target_sku: string;
  order_numbers: string | null;
  resolved_by_email: string | null;
  resolved_at: string;
};

function mapOneOffReconciliationRow(row: OneOffReconciliationRow): OneOffReconciliation {
  return {
    id: row.id,
    itemKey: row.item_key,
    itemName: row.item_name,
    qty: Number(row.qty) || 0,
    targetSku: row.target_sku,
    orderNumbers: row.order_numbers ?? "",
    resolvedByEmail: row.resolved_by_email ?? "",
    resolvedAt: row.resolved_at,
  };
}

export async function loadOneOffReconciliations(accessToken?: string): Promise<OneOffReconciliation[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl("one_off_reconciliations?select=*&order=resolved_at.desc&limit=1000"), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as OneOffReconciliationRow[];
  return rows.map(mapOneOffReconciliationRow);
}

export async function logOneOffReconciliation(entry: OneOffReconciliation, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  // Deliberately not sending entry.id -- it's a client-side makeId("oor")
  // string (e.g. "oor-1735099200000-a1b2c3"), not a real UUID, and
  // one_off_reconciliations.id is `uuid primary key default
  // gen_random_uuid()`. Sending it caused every single insert to fail with
  // an "invalid input syntax for type uuid" 400 -- silently, since this
  // function never checked response.ok, so no merge's reconciliation record
  // ever actually reached the database. The merged item's stock/movement
  // still landed correctly (that's a separate write), but the one-off
  // reappeared at full quantity on every reload since nothing was ever
  // recorded as reconciled. Let Postgres generate the real id instead.
  const response = await fetch(supabaseUrl("one_off_reconciliations"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=minimal" },
    body: JSON.stringify({
      item_key: entry.itemKey,
      item_name: entry.itemName,
      qty: entry.qty,
      target_sku: entry.targetSku,
      order_numbers: entry.orderNumbers || null,
      resolved_by_email: entry.resolvedByEmail || null,
      resolved_at: entry.resolvedAt,
    }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Could not record the one-off reconciliation"));
  }
}

function asPersistedState(records: Array<{ record_key: string; data: unknown }>): PersistedAppState | null {
  if (records.length === 0) {
    return null;
  }

  const byKey = new Map(records.map((record) => [record.record_key, record.data]));
  return {
    roleMode: typeof byKey.get("roleMode") === "string" ? (byKey.get("roleMode") as string) : "manager",
  };
}

export function loadLocalAppState(): PersistedAppState | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STATE_KEY);
    return raw ? (JSON.parse(raw) as PersistedAppState) : null;
  } catch {
    return null;
  }
}

export function saveLocalAppState(state: PersistedAppState) {
  window.localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
}

export function loadAuthSession(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

export function saveAuthSession(session: AuthSession | null) {
  if (!session) {
    window.localStorage.removeItem(AUTH_SESSION_KEY);
    return;
  }
  window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

function normalizeAuthSession(payload: {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
}): AuthSession {
  if (!payload.access_token || !payload.refresh_token || !payload.user?.id || !payload.user?.email) {
    throw new Error("Supabase auth did not return a complete session.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000,
    email: payload.user.email,
    userId: payload.user.id,
  };
}

export async function signInWithPassword(email: string, password: string): Promise<AuthSession> {
  const response = await fetch(supabaseAuthUrl("token?grant_type=password"), {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Sign in failed"));
  }

  const session = normalizeAuthSession(await response.json());
  saveAuthSession(session);
  return session;
}

export async function signUpWithPassword(email: string, password: string): Promise<AuthSession | null> {
  const response = await fetch(supabaseAuthUrl("signup"), {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Sign up failed"));
  }

  const payload = await response.json();
  if (!payload.access_token) {
    return null;
  }

  const session = normalizeAuthSession(payload);
  saveAuthSession(session);
  return session;
}

export async function refreshAuthSession(session: AuthSession): Promise<AuthSession> {
  const response = await fetch(supabaseAuthUrl("token?grant_type=refresh_token"), {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });

  if (!response.ok) {
    saveAuthSession(null);
    throw new Error(await readSupabaseError(response, "Session refresh failed"));
  }

  const refreshed = normalizeAuthSession(await response.json());
  saveAuthSession(refreshed);
  return refreshed;
}

export function signInWithGoogleRedirect() {
  if (!isRemotePersistenceConfigured()) {
    throw new Error("Supabase is not configured.");
  }

  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const authorizeUrl = `${supabaseAuthUrl("authorize")}?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
  window.location.assign(authorizeUrl);
}

export async function requestPasswordReset(email: string) {
  if (!isRemotePersistenceConfigured()) {
    throw new Error("Supabase is not configured.");
  }
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const response = await fetch(`${supabaseAuthUrl("recover")}?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Password reset failed"));
  }
}

export async function updatePasswordWithRecovery(accessToken: string, password: string) {
  if (!isRemotePersistenceConfigured()) {
    throw new Error("Supabase is not configured.");
  }
  const response = await fetch(supabaseAuthUrl("user"), {
    method: "PUT",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Password update failed"));
  }
}

async function fetchAuthUser(accessToken: string): Promise<{ id: string; email: string } | null> {
  const response = await fetch(supabaseAuthUrl("user"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { id?: string; email?: string };
  if (!payload.id || !payload.email) {
    return null;
  }

  return { id: payload.id, email: payload.email };
}

// After a Google (or other OAuth provider) redirect, Supabase sends the session
// back as a URL hash fragment instead of a normal response body. Call this once
// on app load to pick that fragment up, exchange it for user info, persist the
// session, and scrub the tokens out of the visible URL/history.
export async function consumeOAuthRedirectSession(): Promise<AuthSession | null> {
  if (typeof window === "undefined") {
    return null;
  }

  const queryParams = new URLSearchParams(window.location.search);
  const queryError = queryParams.get("error_description") || queryParams.get("error") || queryParams.get("error_code");
  if (queryError) {
    queryParams.delete("error");
    queryParams.delete("error_code");
    queryParams.delete("error_description");
    const cleanQuery = queryParams.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}`);
    throw new Error(`Google sign-in failed: ${queryError}`);
  }

  const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (!rawHash || (!rawHash.includes("access_token") && !rawHash.includes("error"))) {
    return null;
  }

  const params = new URLSearchParams(rawHash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const expiresIn = params.get("expires_in");
  const authFlow = params.get("type") || undefined;
  const errorDescription = params.get("error_description") || params.get("error") || params.get("error_code");

  // Always clear the token fragment so tokens do not sit in browser history.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);

  if (errorDescription) {
    throw new Error(errorDescription);
  }

  if (!accessToken || !refreshToken) {
    return null;
  }

  const user = await fetchAuthUser(accessToken);
  if (!user) {
    throw new Error("Google sign-in did not return a valid Supabase user.");
  }

  const session: AuthSession = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(expiresIn) || 3600) * 1000,
    email: user.email,
    userId: user.id,
    authFlow,
  };

  if (authFlow !== "recovery") {
    saveAuthSession(session);
  }
  return session;
}

export async function signOut(session: AuthSession | null) {
  if (session && isRemotePersistenceConfigured()) {
    await fetch(supabaseAuthUrl("logout"), {
      method: "POST",
      headers: supabaseHeaders(session.accessToken),
    }).catch(() => undefined);
  }
  saveAuthSession(null);
}

export async function acquireTransactionLock(lockType: "inventory_item" | "project" | "build" | "purchase_request", lockKey: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }

  // Goes through the acquire_transaction_lock RPC (migration 069), not a
  // plain INSERT -- a plain INSERT permanently fails on the second-ever
  // lock attempt for a given key, because releaseTransactionLock() never
  // deletes the row, only sets released_at, and the table's unique
  // constraint is on the raw (workspace_key, lock_key, lock_type) tuple
  // regardless of release state. The RPC reclaims released/expired rows
  // and only raises when a lock is genuinely still held.
  const response = await fetch(supabaseUrl("rpc/acquire_transaction_lock"), {
    method: "POST",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({
      p_workspace_key: WORKSPACE_KEY,
      p_lock_type: lockType,
      p_lock_key: lockKey,
      p_owner_label: "ergon-web-app",
      p_ttl_seconds: 300,
    }),
  });

  if (!response.ok) {
    throw new Error(`Record is locked for another operation: ${lockKey}`);
  }

  const row = (await response.json()) as { id?: string } | null;
  return row?.id ?? null;
}

export async function releaseTransactionLock(lockId: string | null, accessToken?: string) {
  if (!lockId || !isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  await fetch(supabaseUrl(`app_transaction_locks?id=eq.${lockId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ released_at: new Date().toISOString() }),
  }).catch(() => undefined);
}

export async function loadUserRoleMode(userId: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }

  const response = await fetch(supabaseUrl(`app_user_roles?user_id=eq.${userId}&is_primary=eq.true&select=role_key&limit=1`), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return null;
  }

  const rows = (await response.json()) as Array<{ role_key?: string }>;
  return rows[0]?.role_key ?? null;
}

// All of a user's roles -- primary and secondary -- used to compute their
// effective default tab set (union of every role's defaults) and, later,
// to route role-assigned tasks to everyone holding a given role.
export async function loadOwnRoleKeys(userId: string, accessToken?: string): Promise<string[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }

  const response = await fetch(supabaseUrl(`app_user_roles?user_id=eq.${userId}&select=role_key`), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as Array<{ role_key: string }>;
  return rows.map((row) => row.role_key);
}

// Who currently holds a given role -- used to broadcast a role-assigned task
// (see EOTask.assignedRoleKey) to every member of that team as a
// notification. Goes through the get_users_by_role RPC (migration 042)
// rather than querying app_user_roles directly, since a regular user's read
// access there is limited to their own row (see migration 010's RLS policy).
export async function loadUsersByRole(roleKey: string, accessToken?: string): Promise<Array<{ userId: string; email: string }>> {
  if (!isRemotePersistenceConfigured() || !accessToken || !roleKey) {
    return [];
  }

  const response = await fetch(supabaseUrl("rpc/get_users_by_role"), {
    method: "POST",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ target_role: roleKey }),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as Array<{ user_id: string; email: string }>;
  return rows.map((row) => ({ userId: row.user_id, email: row.email }));
}

export async function loadOwnAllowedViews(userId: string, accessToken?: string): Promise<string[] | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }

  const response = await fetch(supabaseUrl(`app_user_roles?user_id=eq.${userId}&is_primary=eq.true&select=allowed_views&limit=1`), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return null;
  }

  const rows = (await response.json()) as Array<{ allowed_views?: string[] | null }>;
  return rows[0]?.allowed_views ?? null;
}

// Requires the target user to already have an app_user_roles row (assign a
// role first). PATCH only updates an existing row rather than risking an
// insert that is missing the required role_key.
// Migration 124: routed through the bridge_set_user_allowed_views() RPC
// instead of a direct PATCH -- this is the fifth (and last) of the live
// direct-write functions to be bridged; a corrected requirement from the
// first draft of migration 124, which left this one unbridged despite
// its own documentation implying otherwise. Legacy-only write (no
// workspace-side equivalent for allowed_views exists) -- the RPC still
// re-verifies admin status and that exactly one primary-role row exists
// server-side, rather than trusting the caller.
export async function setUserAllowedViews(userId: string, allowedViews: string[] | null, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const response = await fetch(supabaseUrl("rpc/bridge_set_user_allowed_views"), {
    method: "POST",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ target_user_id: userId, new_allowed_views: allowedViews }),
  });

  if (!response.ok) {
    throw new Error(`Could not update tab permissions: ${response.status}`);
  }
}

// Sets a user's PRIMARY role (the one that drives their default tab set).
// Migration 124: routed through the bridge_set_primary_role() RPC instead
// of writing app_user_roles directly -- the RPC does the exact same
// delete-then-upsert against app_user_roles this function used to do
// itself, AND mirrors the change into workspace_member_roles in the same
// transaction (see PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md
// Part 9.7.1). The RPC also re-checks admin status server-side rather
// than trusting the caller.
export async function setPrimaryUserRole(userId: string, roleKey: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const response = await fetch(supabaseUrl("rpc/bridge_set_primary_role"), {
    method: "POST",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ target_user_id: userId, new_role_key: roleKey }),
  });

  if (!response.ok) {
    throw new Error(`Could not set primary role: ${response.status}`);
  }
}

// Secondary roles: additional access without replacing the primary role.
// Migration 124: routed through the bridge_set_secondary_roles() RPC --
// same delete-and-replace-the-whole-set shape as before, now mirrored
// into workspace_member_roles atomically alongside the legacy write.
export async function setSecondaryUserRoles(userId: string, roleKeys: string[], accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const response = await fetch(supabaseUrl("rpc/bridge_set_secondary_roles"), {
    method: "POST",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ target_user_id: userId, new_role_keys: roleKeys }),
  });

  if (!response.ok) {
    throw new Error(`Could not set secondary roles: ${response.status}`);
  }
}

export async function saveUserRoleMode(userId: string, roleKey: string, accessToken?: string) {
  return setPrimaryUserRole(userId, roleKey, accessToken);
}

// --- Invite flow (migration 041) --------------------------------------
// Real invites: an Admin picks an email + mandatory primary role + optional
// secondary roles, the app emails a unique link, and accepting the invite
// (see acceptInvite below) auto-approves the account and assigns those
// roles -- no sitting in the Pending Approvals queue, since the invite
// itself was the approval.

export type UserInvite = {
  id: string;
  token: string;
  email: string;
  fullName: string;
  primaryRole: string;
  secondaryRoles: string[];
  invitedByEmail: string;
  status: "pending" | "accepted" | "revoked";
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
};

type UserInviteRow = {
  id: string;
  token: string;
  email: string;
  full_name: string | null;
  primary_role: string;
  secondary_roles: string[] | null;
  invited_by_email: string | null;
  status: "pending" | "accepted" | "revoked";
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
};

function mapUserInviteRow(row: UserInviteRow): UserInvite {
  return {
    id: row.id,
    token: row.token,
    email: row.email,
    fullName: row.full_name ?? "",
    primaryRole: row.primary_role,
    secondaryRoles: row.secondary_roles ?? [],
    invitedByEmail: row.invited_by_email ?? "",
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  };
}

export async function loadInvites(accessToken?: string): Promise<UserInvite[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }

  const response = await fetch(supabaseUrl("user_invites?select=*&order=created_at.desc"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as UserInviteRow[];
  return rows.map(mapUserInviteRow);
}

export async function createInvite(
  input: { email: string; fullName: string; primaryRole: string; secondaryRoles: string[]; invitedByEmail: string },
  accessToken?: string,
): Promise<UserInvite | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }

  const response = await fetch(supabaseUrl("user_invites"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      full_name: input.fullName.trim() || null,
      primary_role: input.primaryRole,
      secondary_roles: input.secondaryRoles,
      invited_by_email: input.invitedByEmail,
    }),
  });

  if (!response.ok) {
    throw new Error(`Could not create invite: ${response.status}`);
  }

  const rows = (await response.json()) as UserInviteRow[];
  return rows[0] ? mapUserInviteRow(rows[0]) : null;
}

export async function revokeInvite(id: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const response = await fetch(supabaseUrl(`user_invites?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ status: "revoked" }),
  });
  if (!response.ok) {
    throw new Error(`Could not revoke invite: ${response.status}`);
  }
  // A permissions-blocked PATCH still returns 200/204 with zero rows changed
  // -- without checking the row count, "revoked" could show as confirmed
  // while the invite link stays live.
  const rows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error("Revoke didn't affect anything -- you may not have permission to revoke invites.");
  }
}

export type PublicInviteView = {
  email: string;
  fullName: string;
  primaryRole: string;
  secondaryRoles: string[];
  status: "pending" | "accepted" | "revoked";
};

// Anon-safe: called from the pre-login invite landing page, before the
// visitor has any session. Talks only to the get_invite_by_token RPC, which
// returns sanitized fields for a single invite -- never the raw table.
export async function fetchInviteByToken(token: string): Promise<PublicInviteView | null> {
  if (!isRemotePersistenceConfigured() || !token) {
    return null;
  }

  const response = await fetch(supabaseUrl("rpc/get_invite_by_token"), {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify({ lookup_token: token }),
  });

  if (!response.ok) {
    return null;
  }

  const rows = (await response.json()) as Array<{
    email: string;
    full_name: string | null;
    primary_role: string;
    secondary_roles: string[] | null;
    status: "pending" | "accepted" | "revoked";
  }>;

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  return {
    email: row.email,
    fullName: row.full_name ?? "",
    primaryRole: row.primary_role,
    secondaryRoles: row.secondary_roles ?? [],
    status: row.status,
  };
}

// Called with the invitee's own freshly-created session, right after they
// finish signup/Google OAuth from the invite landing page. Assigns the
// roles the admin chose and auto-approves the account server-side (see
// accept_invite in migration 041).
export async function acceptInvite(token: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken || !token) {
    return false;
  }

  const response = await fetch(supabaseUrl("rpc/accept_invite"), {
    method: "POST",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ lookup_token: token }),
  });

  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Invite acceptance failed"));
  }

  return true;
}

export type KnownUser = {
  userId: string;
  email: string;
  lastSeenAt: string;
};

// Best-effort by design (called on ordinary interaction events, not a
// user-initiated save) -- stays fire-and-forget from the caller's
// perspective. Previously swallowed both network AND HTTP failures with
// zero signal at all; now at least logs a real failure to the console
// instead of looking identical to success, without changing the
// function's void/fire-and-forget contract for any of its call sites.
export async function upsertKnownUser(userId: string, email: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  try {
    const response = await fetch(supabaseUrl("app_known_users?on_conflict=user_id"), {
      method: "POST",
      headers: {
        ...supabaseHeaders(accessToken),
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        user_id: userId,
        email,
        last_seen_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      console.error(`upsertKnownUser failed for ${userId}: ${response.status}`);
    }
  } catch (error) {
    console.error(`upsertKnownUser network error for ${userId}:`, error);
  }
}

export async function checkIsAdmin(userId: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }

  const response = await fetch(supabaseUrl(`app_admins?user_id=eq.${userId}&select=user_id`), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return false;
  }

  const rows = (await response.json()) as Array<{ user_id?: string }>;
  return rows.length > 0;
}

export async function loadAllKnownUsers(accessToken?: string): Promise<KnownUser[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }

  const response = await fetch(supabaseUrl("app_known_users?select=user_id,email,last_seen_at&order=email.asc"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as Array<{ user_id: string; email: string; last_seen_at: string }>;
  return rows.map((row) => ({ userId: row.user_id, email: row.email, lastSeenAt: row.last_seen_at }));
}

// --- Direct Messages (migration 094) ---------------------------------
// Ported concept (not code) from the VLTD sister project, per E: "I have a
// direct message and alert system built into it now, I think we need that
// on this also." Deliberately a different schema shape than VLTD's --
// VLTD's `profiles.id` IS `auth.users.id` by construction, so any
// conversation participant is guaranteed to be a real logged-in user.
// Ergon has no such table (`team_members` is explicitly NOT tied to
// auth.users -- see migration 019), so conversations reference
// `app_known_users`' real `auth.users.id` directly instead. No
// supabase-js/realtime client exists anywhere in this app (every other
// feature is plain REST fetch()) -- this follows that same convention and
// polls rather than subscribing to Postgres changes; see main.tsx for the
// poll interval and why.

export type Conversation = {
  id: string;
  participantAId: string;
  participantBId: string;
  lastMessageAt: string;
  createdAt: string;
};

type ConversationRow = {
  id: string;
  participant_a_id: string;
  participant_b_id: string;
  last_message_at: string;
  created_at: string;
};

function mapConversationRow(row: ConversationRow): Conversation {
  return {
    id: row.id,
    participantAId: row.participant_a_id,
    participantBId: row.participant_b_id,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

export type DirectMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  attachmentStoragePath: string | null;
  attachmentFileName: string | null;
  attachmentMimeType: string | null;
  attachmentSizeBytes: number | null;
};

type DirectMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
  attachment_storage_path: string | null;
  attachment_file_name: string | null;
  attachment_mime_type: string | null;
  attachment_size_bytes: number | string | null;
};

function mapDirectMessageRow(row: DirectMessageRow): DirectMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body ?? "",
    createdAt: row.created_at,
    readAt: row.read_at,
    attachmentStoragePath: row.attachment_storage_path ?? null,
    attachmentFileName: row.attachment_file_name ?? null,
    attachmentMimeType: row.attachment_mime_type ?? null,
    attachmentSizeBytes: row.attachment_size_bytes == null ? null : Number(row.attachment_size_bytes),
  };
}

export async function loadConversations(userId: string, accessToken?: string): Promise<Conversation[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(
    supabaseUrl(`conversations?or=(participant_a_id.eq.${userId},participant_b_id.eq.${userId})&order=last_message_at.desc`),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as ConversationRow[];
  return rows.map(mapConversationRow);
}

export async function loadConversationMessages(conversationId: string, accessToken?: string): Promise<DirectMessage[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl(`direct_messages?conversation_id=eq.${conversationId}&order=created_at.asc&limit=500`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as DirectMessageRow[];
  return rows.map(mapDirectMessageRow);
}

// Sorts the two ids into the schema's canonical (a < b) order before every
// read/write -- the unique constraint on (participant_a_id, participant_b_id)
// means the pair is the same conversation no matter who started it, but
// only if both sides always query it in the same order.
export function canonicalConversationPair(userIdA: string, userIdB: string): [string, string] {
  return userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];
}

export async function getOrCreateConversation(myUserId: string, otherUserId: string, accessToken?: string): Promise<Conversation> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Not configured.");
  }
  const [participantAId, participantBId] = canonicalConversationPair(myUserId, otherUserId);
  const response = await fetch(supabaseUrl("conversations?on_conflict=participant_a_id,participant_b_id"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ participant_a_id: participantAId, participant_b_id: participantBId }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Could not start conversation"));
  }
  const rows = (await response.json()) as ConversationRow[];
  if (rows.length === 0) {
    throw new Error("Could not start conversation -- you may not have permission.");
  }
  return mapConversationRow(rows[0]);
}

export async function sendDirectMessage(
  conversationId: string,
  senderId: string,
  body: string,
  accessToken?: string,
  attachment?: { storagePath: string; fileName: string; mimeType: string; sizeBytes: number },
): Promise<DirectMessage> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Not configured.");
  }
  const response = await fetch(supabaseUrl("direct_messages"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      conversation_id: conversationId,
      sender_id: senderId,
      body: body.trim() || null,
      attachment_storage_path: attachment?.storagePath ?? null,
      attachment_file_name: attachment?.fileName ?? null,
      attachment_mime_type: attachment?.mimeType ?? null,
      attachment_size_bytes: attachment?.sizeBytes ?? null,
    }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Could not send message"));
  }
  const rows = (await response.json()) as DirectMessageRow[];
  if (rows.length === 0) {
    throw new Error("Message didn't send -- you may not have permission.");
  }
  return mapDirectMessageRow(rows[0]);
}

// Reactions (migration 113) -- see the channel_message_reactions entry
// above for the full design note; this is the DM-side mirror.
export async function loadDirectMessageReactions(messageIds: string[], accessToken?: string): Promise<MessageReaction[]> {
  if (!isRemotePersistenceConfigured() || !accessToken || messageIds.length === 0) {
    return [];
  }
  const response = await fetch(
    supabaseUrl(`direct_message_reactions?message_id=in.(${messageIds.join(",")})&select=id,message_id,user_id,emoji`),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as MessageReactionRow[];
  return rows.map(mapMessageReactionRow);
}

// Reviewed 2026-09-12 (overnight reliability closeout part 2, task 2):
// logging-only, deliberately non-throwing -- the caller
// (handleToggleDirectMessageReaction, main.tsx) has no try/catch at any
// level from the raw onClick down to this fetch, and the DM thread's own
// 5s poll already self-corrects a failed reaction within a few seconds
// (the emoji "flickers back"). A thrown error here would be a genuine
// unhandled promise rejection, a worse failure mode than today's silent
// no-op -- this only makes a real failure visible in the console.
export async function addDirectMessageReaction(messageId: string, userId: string, emoji: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const response = await fetch(supabaseUrl("direct_message_reactions"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ message_id: messageId, user_id: userId, emoji }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`addDirectMessageReaction: insert failed for message ${messageId} (${response.status}): ${bodyText}`);
  }
}

export async function removeDirectMessageReaction(messageId: string, userId: string, emoji: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const response = await fetch(
    supabaseUrl(`direct_message_reactions?message_id=eq.${messageId}&user_id=eq.${userId}&emoji=eq.${encodeURIComponent(emoji)}`),
    { method: "DELETE", headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`removeDirectMessageReaction: delete failed for message ${messageId} (${response.status}): ${bodyText}`);
  }
}

// Message attachments (migration 100) -- private per-conversation bucket,
// storage path prefixed with the conversation id so the bucket's own RLS
// (see the migration) can restrict access to just the two participants,
// same guarantee direct_messages' own row-level security already gives
// the text. Signed URLs (1hr) are resolved on demand, same pattern as
// project-documents/getDocumentDownloadUrl.
const MESSAGE_ATTACHMENT_BUCKET = "message-attachments";

export function buildMessageAttachmentStoragePath(conversationId: string, fileName: string): string {
  const stamp = Date.now().toString(36);
  const safeName = fileName.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 120) || "file";
  return `${conversationId}/${stamp}-${safeName}`;
}

export async function uploadMessageAttachment(file: File, storagePath: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
  const response = await fetch(
    `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/${MESSAGE_ATTACHMENT_BUCKET}/${storagePath}`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": file.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: file,
    },
  );
  return response.ok;
}

export async function getMessageAttachmentUrl(storagePath: string, accessToken?: string): Promise<string | null> {
  if (!isRemotePersistenceConfigured() || !accessToken || !storagePath) {
    return null;
  }
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
  const response = await fetch(
    `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/sign/${MESSAGE_ATTACHMENT_BUCKET}/${storagePath}`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    },
  );
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { signedURL?: string };
  if (!body.signedURL) {
    return null;
  }
  return `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1${body.signedURL}`;
}

// Avatars (migration 109) -- E: "Add user images to the main setup that
// will carry next to these messages." Public bucket, unlike
// message-attachments above -- an avatar isn't sensitive, and public
// means every message bubble can use the URL directly with no signed-URL
// round trip. avatar_url on team_members stores this full public URL,
// not just a storage path, so nothing that renders an avatar needs to
// resolve anything further.
const AVATAR_BUCKET = "avatars";

export function buildAvatarStoragePath(teamMemberId: string, fileName: string): string {
  const stamp = Date.now().toString(36);
  const extMatch = fileName.match(/\.[a-zA-Z0-9]+$/);
  const ext = extMatch ? extMatch[0] : "";
  return `${teamMemberId}/${stamp}${ext}`;
}

export async function uploadTeamMemberAvatar(file: File, storagePath: string, accessToken?: string): Promise<string | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
  const baseUrl = envValue("VITE_SUPABASE_URL").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/storage/v1/object/${AVATAR_BUCKET}/${storagePath}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": file.type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: file,
  });
  if (!response.ok) {
    return null;
  }
  return `${baseUrl}/storage/v1/object/public/${AVATAR_BUCKET}/${storagePath}`;
}

// --- Group channels (migration 101) -- phase 1 of the Slack/ClickUp/
// Drive replacement roadmap (see HANDOFF.md). One shared shape for every
// channel type (section-wide or per-project today; per-client in a later
// phase) rather than a separate system per type -- the embedded
// "Discussion" tabs and the future Messages-hub rebuild are two views of
// this same data. Broadly authenticated, unlike direct_messages -- these
// are team-visible channels, not private 1:1s; real visibility is
// enforced the same way every other section already is, client-side by
// tab access, not a new per-channel ACL.
export type Channel = {
  id: string;
  type: "section" | "project" | "client" | "group";
  sectionKey: string | null;
  projectId: string | null;
  clientId: string | null;
  name: string;
  // 'group' only (migration 105) -- freeform, user-created channels.
  // Section/Project/Client channels are never private and ignore this.
  private: boolean;
  createdBy: string | null;
};

type ChannelRow = {
  id: string;
  type: "section" | "project" | "client" | "group";
  section_key: string | null;
  project_id: string | null;
  client_id: string | null;
  name: string;
  private?: boolean;
  created_by?: string | null;
  deleted_at?: string | null;
};

function mapChannelRow(row: ChannelRow): Channel {
  return {
    id: row.id,
    type: row.type,
    sectionKey: row.section_key,
    projectId: row.project_id,
    clientId: row.client_id ?? null,
    name: row.name,
    private: row.private ?? false,
    createdBy: row.created_by ?? null,
  };
}

export async function loadChannels(accessToken?: string): Promise<Channel[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  // select=* rather than an explicit column list -- client_id (migration
  // 102) was added after this table's own migration (101), so an
  // explicit list would 400 in the gap between running one and the
  // other. * just picks up whatever columns exist right now, same
  // graceful-in-between behavior loadTeamMembers already relies on.
  const response = await fetch(supabaseUrl("channels?select=*&order=name.asc"), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as ChannelRow[];
  // Filtered client-side, not via a query param -- deleted_at (migration
  // 112) doesn't exist pre-migration, and a query filter on a missing
  // column 400s the whole request where a missing-column read just comes
  // back undefined (falsy) and is included, same as the graceful-*
  // pattern above.
  return rows.filter((row) => !row.deleted_at).map(mapChannelRow);
}

// Migration 112: delete/retire a user-created ("group") channel. E: "No
// way to delete items or even rooms, Delete or Retire should be the
// options." Same soft-delete/restore/deletion_log shape as every other
// entity in this app (migration 088) -- Section/Project/Client channels
// stay permanent, the UI never offers this for them.
export async function deleteChannel(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`channels?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete channel") };
  }
  const rows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (rows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("channel", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

// Freeform group channels (migration 105) -- E: "create group chats that
// are private or can be unlocked, also be able to add people to them."
// Private by default; membership is a real table for the first time
// (channel_members) since Section/Project/Client channels don't need
// one -- they're broadly visible to the whole team already.
export async function createGroupChannel(name: string, creatorUserId: string, memberUserIds: string[], accessToken?: string): Promise<Channel> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Not configured.");
  }
  const response = await fetch(supabaseUrl("channels"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ type: "group", name: name.trim(), private: true, created_by: creatorUserId }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Could not create channel"));
  }
  const rows = (await response.json()) as ChannelRow[];
  if (rows.length === 0) {
    throw new Error("Channel didn't save -- you may not have permission.");
  }
  const channel = mapChannelRow(rows[0]);
  const memberIds = [...new Set([creatorUserId, ...memberUserIds])];
  const membersResponse = await fetch(supabaseUrl("channel_members"), {
    method: "POST",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(memberIds.map((userId) => ({ channel_id: channel.id, user_id: userId }))),
  });
  if (!membersResponse.ok) {
    throw new Error(await readSupabaseError(membersResponse, "Channel created, but adding members failed"));
  }
  return channel;
}

export async function unlockChannel(channelId: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Not configured.");
  }
  const response = await fetch(supabaseUrl(`channels?id=eq.${channelId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ private: false }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Could not unlock channel"));
  }
}

// E: "once i unlock it, i cant lock it again from inside the chat" --
// unlock only ever went one way. Existing channel_members are untouched
// by either direction -- locking just re-restricts who can newly see
// it, it doesn't remove anyone already in it.
export async function lockChannel(channelId: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Not configured.");
  }
  const response = await fetch(supabaseUrl(`channels?id=eq.${channelId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ private: true }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Could not lock channel"));
  }
}

export type ChannelMember = {
  channelId: string;
  userId: string;
  addedAt: string;
};

type ChannelMemberRow = {
  channel_id: string;
  user_id: string;
  added_at: string;
};

export async function loadChannelMembers(channelId: string, accessToken?: string): Promise<ChannelMember[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl(`channel_members?channel_id=eq.${channelId}&select=*`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as ChannelMemberRow[];
  return rows.map((row) => ({ channelId: row.channel_id, userId: row.user_id, addedAt: row.added_at }));
}

export async function addChannelMember(channelId: string, userId: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Not configured.");
  }
  const response = await fetch(supabaseUrl("channel_members"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ channel_id: channelId, user_id: userId }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Could not add member"));
  }
}

// --- Clients (migration 102) -- phase 4 of the roadmap, built from a
// reconciliation pass confirmed with E 2026-08-30 (see the migration's
// own comment for the exact matches). Deliberately just id/name/created
// tonight -- linking existing projects/sales_quotes and standing up each
// client's own channel both happen server-side in the migration itself,
// not here.
export type Client = {
  id: string;
  name: string;
  createdAt: string;
};

type ClientRow = {
  id: string;
  name: string;
  created_at: string;
};

function mapClientRow(row: ClientRow): Client {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

export async function loadClients(accessToken?: string): Promise<Client[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl("clients?select=id,name,created_at&order=name.asc"), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as ClientRow[];
  return rows.map(mapClientRow);
}

export async function createClient(name: string, accessToken?: string): Promise<Client> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Not configured.");
  }
  const response = await fetch(supabaseUrl("clients"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ name: name.trim() }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Could not add client"));
  }
  const rows = (await response.json()) as ClientRow[];
  if (rows.length === 0) {
    throw new Error("Client didn't save -- you may not have permission.");
  }
  return mapClientRow(rows[0]);
}

export type ChannelMessage = {
  id: string;
  channelId: string;
  senderId: string;
  body: string;
  createdAt: string;
  attachmentStoragePath: string | null;
  attachmentFileName: string | null;
  attachmentMimeType: string | null;
  attachmentSizeBytes: number | null;
};

type ChannelMessageRow = {
  id: string;
  channel_id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
  attachment_storage_path: string | null;
  attachment_file_name: string | null;
  attachment_mime_type: string | null;
  attachment_size_bytes: number | string | null;
};

function mapChannelMessageRow(row: ChannelMessageRow): ChannelMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    senderId: row.sender_id,
    body: row.body ?? "",
    createdAt: row.created_at,
    attachmentStoragePath: row.attachment_storage_path ?? null,
    attachmentFileName: row.attachment_file_name ?? null,
    attachmentMimeType: row.attachment_mime_type ?? null,
    attachmentSizeBytes: row.attachment_size_bytes == null ? null : Number(row.attachment_size_bytes),
  };
}

export async function loadChannelMessages(channelId: string, accessToken?: string): Promise<ChannelMessage[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl(`channel_messages?channel_id=eq.${channelId}&order=created_at.asc&limit=500`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as ChannelMessageRow[];
  return rows.map(mapChannelMessageRow);
}

export async function sendChannelMessage(
  channelId: string,
  senderId: string,
  body: string,
  accessToken?: string,
  attachment?: { storagePath: string; fileName: string; mimeType: string; sizeBytes: number },
): Promise<ChannelMessage> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Not configured.");
  }
  const response = await fetch(supabaseUrl("channel_messages"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      channel_id: channelId,
      sender_id: senderId,
      body: body.trim() || null,
      attachment_storage_path: attachment?.storagePath ?? null,
      attachment_file_name: attachment?.fileName ?? null,
      attachment_mime_type: attachment?.mimeType ?? null,
      attachment_size_bytes: attachment?.sizeBytes ?? null,
    }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Could not send message"));
  }
  const rows = (await response.json()) as ChannelMessageRow[];
  if (rows.length === 0) {
    throw new Error("Message didn't send -- you may not have permission.");
  }
  return mapChannelMessageRow(rows[0]);
}

// Reactions (migration 113) -- Slack's signature feature, mirrored the
// same way channel_message_reactions/direct_message_reactions mirror
// channel_messages/direct_messages themselves. `(message_id, user_id,
// emoji)` is unique, so "react" is add-if-absent / remove-if-present
// (a toggle), never a duplicate row for the same person+emoji.
export type MessageReaction = { id: string; messageId: string; userId: string; emoji: string };

type MessageReactionRow = { id: string; message_id: string; user_id: string; emoji: string };

function mapMessageReactionRow(row: MessageReactionRow): MessageReaction {
  return { id: row.id, messageId: row.message_id, userId: row.user_id, emoji: row.emoji };
}

export async function loadChannelMessageReactions(messageIds: string[], accessToken?: string): Promise<MessageReaction[]> {
  if (!isRemotePersistenceConfigured() || !accessToken || messageIds.length === 0) {
    return [];
  }
  const response = await fetch(
    supabaseUrl(`channel_message_reactions?message_id=in.(${messageIds.join(",")})&select=id,message_id,user_id,emoji`),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as MessageReactionRow[];
  return rows.map(mapMessageReactionRow);
}

// Reviewed 2026-09-12 (overnight reliability closeout part 2, task 2):
// logging-only, deliberately non-throwing -- same reasoning as
// addDirectMessageReaction/removeDirectMessageReaction above (no
// try/catch anywhere in the caller chain, the channel's own 5s poll
// already self-corrects a failed reaction).
export async function addChannelMessageReaction(messageId: string, userId: string, emoji: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const response = await fetch(supabaseUrl("channel_message_reactions"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ message_id: messageId, user_id: userId, emoji }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`addChannelMessageReaction: insert failed for message ${messageId} (${response.status}): ${bodyText}`);
  }
}

export async function removeChannelMessageReaction(messageId: string, userId: string, emoji: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const response = await fetch(
    supabaseUrl(`channel_message_reactions?message_id=eq.${messageId}&user_id=eq.${userId}&emoji=eq.${encodeURIComponent(emoji)}`),
    { method: "DELETE", headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`removeChannelMessageReaction: delete failed for message ${messageId} (${response.status}): ${bodyText}`);
  }
}

// Canvas (migration 104) -- Slack's per-channel Canvas tab, mapped onto a
// single persistent notes/scope doc pinned to the channel. E, from real
// Slack screenshots: "Canvas -> a persistent notes/scope doc pinned to
// the channel." One row per channel (channel_id is the primary key), so
// saving is always an upsert.
export type ChannelCanvas = {
  channelId: string;
  content: string;
  updatedBy: string | null;
  updatedAt: string;
};

type ChannelCanvasRow = {
  channel_id: string;
  content: string;
  updated_by: string | null;
  updated_at: string;
};

function mapChannelCanvasRow(row: ChannelCanvasRow): ChannelCanvas {
  return { channelId: row.channel_id, content: row.content, updatedBy: row.updated_by, updatedAt: row.updated_at };
}

export async function loadChannelCanvas(channelId: string, accessToken?: string): Promise<ChannelCanvas | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const response = await fetch(supabaseUrl(`channel_canvas?channel_id=eq.${channelId}&select=*`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as ChannelCanvasRow[];
  return rows.length > 0 ? mapChannelCanvasRow(rows[0]) : null;
}

export async function saveChannelCanvas(channelId: string, content: string, updatedBy: string, accessToken?: string): Promise<ChannelCanvas> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Not configured.");
  }
  const response = await fetch(supabaseUrl("channel_canvas"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ channel_id: channelId, content, updated_by: updatedBy, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Could not save canvas"));
  }
  const rows = (await response.json()) as ChannelCanvasRow[];
  if (rows.length === 0) {
    throw new Error("Canvas didn't save -- you may not have permission.");
  }
  return mapChannelCanvasRow(rows[0]);
}

// Global search, phase 3 of the Slack/ClickUp/Drive roadmap (HANDOFF.md)
// -- the piece E specifically called out ("this is lacking in Slack").
// Old messages are never loaded into memory just for browsing (DM
// threads load per-conversation, channel threads load per-channel), so
// unlike the rest of global search (a client-side filter over data
// that's already in state), this is a real on-demand query -- fired only
// when the user actually searches, not cached. RLS does the scoping for
// free: direct_messages already restricts to the caller's own
// conversations, channel_messages is broadly readable same as the
// channels themselves. No date/status filter -- deliberately searches
// closed/archived channels and old conversations too, since "old chats
// are hard to find" was the actual problem being solved here.
export type MessageSearchResult = {
  id: string;
  kind: "dm" | "channel";
  conversationId: string | null;
  channelId: string | null;
  senderId: string;
  body: string;
  createdAt: string;
};

export async function searchMessages(term: string, accessToken?: string, limit: number = 8): Promise<MessageSearchResult[]> {
  if (!isRemotePersistenceConfigured() || !accessToken || term.trim().length < 3) {
    return [];
  }
  const pattern = `*${encodeURIComponent(term.trim())}*`;
  const [dmResponse, channelResponse] = await Promise.all([
    fetch(supabaseUrl(`direct_messages?body=ilike.${pattern}&select=id,conversation_id,sender_id,body,created_at&order=created_at.desc&limit=${limit}`), {
      headers: supabaseHeaders(accessToken),
    }),
    fetch(supabaseUrl(`channel_messages?body=ilike.${pattern}&select=id,channel_id,sender_id,body,created_at&order=created_at.desc&limit=${limit}`), {
      headers: supabaseHeaders(accessToken),
    }),
  ]);
  const dmRows = dmResponse.ok ? ((await dmResponse.json()) as Array<{ id: string; conversation_id: string; sender_id: string; body: string; created_at: string }>) : [];
  const channelRows = channelResponse.ok ? ((await channelResponse.json()) as Array<{ id: string; channel_id: string; sender_id: string; body: string; created_at: string }>) : [];
  const results: MessageSearchResult[] = [
    ...dmRows.map((row) => ({ id: row.id, kind: "dm" as const, conversationId: row.conversation_id, channelId: null, senderId: row.sender_id, body: row.body, createdAt: row.created_at })),
    ...channelRows.map((row) => ({ id: row.id, kind: "channel" as const, conversationId: null, channelId: row.channel_id, senderId: row.sender_id, body: row.body, createdAt: row.created_at })),
  ];
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

// Doesn't need to know which conversations the user is in -- RLS on
// direct_messages already restricts every row returned to conversations
// this user actually participates in, so this is naturally scoped.
export async function loadUnreadDirectMessageCounts(myUserId: string, accessToken?: string): Promise<Record<string, number>> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return {};
  }
  const response = await fetch(supabaseUrl(`direct_messages?select=conversation_id&sender_id=neq.${myUserId}&read_at=is.null`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return {};
  }
  const rows = (await response.json()) as Array<{ conversation_id: string }>;
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.conversation_id] = (counts[row.conversation_id] ?? 0) + 1;
  }
  return counts;
}

// --- Push notification subscriptions (migration 095) -------------------
// `endpoint` is the natural upsert key -- unique per device+browser
// install, so re-subscribing the same device refreshes its keys instead
// of creating a duplicate row. One person can have several rows (phone +
// laptop both opted in); push fans out to every device they've turned it
// on for.
export async function upsertPushSubscription(
  userId: string,
  subscription: { endpoint: string; p256dh: string; authKey: string },
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const response = await fetch(supabaseUrl("push_subscriptions?on_conflict=endpoint"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth_key: subscription.authKey,
      last_seen_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Could not save push subscription"));
  }
  const rows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error("Push subscription didn't save -- you may not have permission.");
  }
}

export async function removePushSubscription(endpoint: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });
}

export async function markConversationRead(conversationId: string, myUserId: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  // Not treated as an error if 0 rows match -- "nothing unread" is the
  // normal case every time you reopen a conversation you're caught up on.
  // The response itself was previously never checked at all -- since
  // fetch() only rejects on network failure, an HTTP failure (e.g. a 401
  // from an expired session) resolved normally, letting a caller's
  // optimistic "mark read" UI update proceed as if the write had
  // succeeded. Now at least logged, so a real failure isn't
  // indistinguishable from the normal "nothing to mark" case.
  const response = await fetch(
    supabaseUrl(`direct_messages?conversation_id=eq.${conversationId}&sender_id=neq.${myUserId}&read_at=is.null`),
    {
      method: "PATCH",
      headers: supabaseHeaders(accessToken),
      body: JSON.stringify({ read_at: new Date().toISOString() }),
    },
  );
  if (!response.ok) {
    console.error(`markConversationRead failed for conversation ${conversationId}: ${response.status}`);
  }
}

export type UserRoles = { primary: string; secondary: string[] };

export async function loadAllUserRoles(accessToken?: string): Promise<Record<string, UserRoles>> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return {};
  }

  const response = await fetch(supabaseUrl("app_user_roles?select=user_id,role_key,is_primary"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return {};
  }

  const rows = (await response.json()) as Array<{ user_id: string; role_key: string; is_primary: boolean }>;
  const map: Record<string, UserRoles> = {};
  rows.forEach((row) => {
    const entry = map[row.user_id] ?? { primary: "", secondary: [] };
    if (row.is_primary) {
      entry.primary = row.role_key;
    } else {
      entry.secondary.push(row.role_key);
    }
    map[row.user_id] = entry;
  });
  return map;
}

export async function loadAllAllowedViews(accessToken?: string): Promise<Record<string, string[] | null>> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return {};
  }

  const response = await fetch(supabaseUrl("app_user_roles?select=user_id,allowed_views&is_primary=eq.true"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return {};
  }

  const rows = (await response.json()) as Array<{ user_id: string; allowed_views: string[] | null }>;
  const map: Record<string, string[] | null> = {};
  rows.forEach((row) => {
    map[row.user_id] = row.allowed_views;
  });
  return map;
}

export async function loadAllAdmins(accessToken?: string): Promise<string[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }

  const response = await fetch(supabaseUrl("app_admins?select=user_id"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as Array<{ user_id: string }>;
  return rows.map((row) => row.user_id);
}

// setUserRole() was removed 2026-09-08: dead code (zero call sites in
// main.tsx, confirmed by whole-project grep), and its
// `on_conflict=user_id` target hadn't matched any real constraint since
// migration 040 replaced app_user_roles' single-column primary key with
// `id` + a `(user_id, role_key)` unique index -- this function could not
// have worked correctly even if something had called it. Removing it now
// rather than bridging it, so it can't silently bypass the new
// bridge_set_primary_role()/bridge_set_secondary_roles() RPCs if anyone
// ever revives it without checking history first.

// Migration 124: routed through bridge_grant_admin()/bridge_revoke_admin()
// instead of writing app_admins directly -- mirrors the change into
// workspace_members.is_workspace_admin in the same transaction,
// one-directionally only (see PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md
// Part 9.7.1) -- a workspace admin is never automatically promoted to a
// global app_admin by this or any other path.
export async function grantAdmin(userId: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const response = await fetch(supabaseUrl("rpc/bridge_grant_admin"), {
    method: "POST",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ target_user_id: userId }),
  });

  if (!response.ok) {
    throw new Error(`Could not grant admin: ${response.status}`);
  }
}

export async function revokeAdmin(userId: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const response = await fetch(supabaseUrl("rpc/bridge_revoke_admin"), {
    method: "POST",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ target_user_id: userId }),
  });

  if (!response.ok) {
    throw new Error(`Could not revoke admin: ${response.status}`);
  }
}

// Company branding (migration 039) -- a singleton row so this same app can
// be reused for a different company by changing the name and logo here,
// with no code/text hardcoded to "Ergon" left anywhere else. Everyone
// signed in can read it (it renders in the top nav); only an admin can
// write it.
export type CompanyBranding = {
  companyName: string;
  logoStoragePath: string;
};

const COMPANY_BRANDING_BUCKET = "company-branding";

export function companyLogoUrl(logoStoragePath: string): string | null {
  if (!logoStoragePath) {
    return null;
  }
  return `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/public/${COMPANY_BRANDING_BUCKET}/${logoStoragePath}`;
}

export async function loadCompanyBranding(accessToken?: string): Promise<CompanyBranding> {
  const fallback: CompanyBranding = { companyName: "Ergon", logoStoragePath: "" };
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return fallback;
  }

  const response = await fetch(supabaseUrl("company_branding?select=company_name,logo_storage_path&id=eq.true"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return fallback;
  }

  const rows = (await response.json()) as Array<{ company_name: string; logo_storage_path: string | null }>;
  if (!rows[0]) {
    return fallback;
  }
  return { companyName: rows[0].company_name || "Ergon", logoStoragePath: rows[0].logo_storage_path ?? "" };
}

export async function saveCompanyBranding(updates: Partial<CompanyBranding>, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const payload: Record<string, unknown> = {};
  if (updates.companyName !== undefined) payload.company_name = updates.companyName;
  if (updates.logoStoragePath !== undefined) payload.logo_storage_path = updates.logoStoragePath || null;

  const response = await fetch(supabaseUrl("company_branding?id=eq.true"), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Could not save company branding: ${response.status}`);
  }
}

export async function uploadCompanyLogo(file: File, accessToken?: string): Promise<string | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
  const storagePath = `logo-${Date.now().toString(36)}-${sanitizeStoragePathSegment(file.name)}`;
  const response = await fetch(
    `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/${COMPANY_BRANDING_BUCKET}/${storagePath}`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": file.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: file,
    },
  );
  if (!response.ok) {
    return null;
  }
  return storagePath;
}

export type CatalogItem = {
  id: string;
  catalogNumber: string;
  productName: string;
  salesDescription: string;
  technicalDescription: string;
  category: string;
  manufacturer: string;
  defaultSellPrice: number;
  costSource: "manual" | "inventory_unit_cost" | "vendor_quote";
  linkedReference: string;
  datasheetUrl: string;
  imageUrl: string;
  isRetired: boolean;
  // Real pricing model: sell price = unitCost x (1 + markupPercent / 100).
  // unitCost is either entered manually (costSource "manual"/"vendor_quote")
  // or, for costSource "inventory_unit_cost", ignored in favor of the
  // linked inventory item's live current cost (see main.tsx's
  // resolveCatalogUnitCost) -- so this stored value is a fallback/snapshot,
  // never the source of truth for that case.
  unitCost: number;
  markupPercent: number;
  // Gaps filled in from E's PandaDoc export (flat_priced_products.csv):
  // bundle/subscription metadata and signage physical specs. Optional --
  // most products won't use most of these.
  itemType: "regular" | "bundle";
  billingFrequency: string;
  bundleComponents: string;
  heightIn: string;
  widthIn: string;
  pixelPitchMm: string;
  builtinFlasherModule: string;
  additionalSpaceMultiplier: number | null;
  insertQuantity: number | null;
  // Free-text tags (comma-separated in the UI), same text[] shape as
  // inventory_items.inventory_tags -- unlike Inventory's fixed-vocabulary
  // chip picker, Catalog tags aren't tied to any BOM-matching logic, so
  // there's no fixed list to enforce here.
  tags: string[];
  // Category-specific "Details" fields (everything except Signage, which
  // keeps using the typed height/width/pixelPitch/etc. fields above).
  // Keyed by field label from CATALOG_CATEGORY_FIELDS in main.tsx -- kept
  // as a flexible bag rather than named columns so a category's field
  // list can change without a migration (migration 052).
  specifications: Record<string, string>;
  // Path to an uploaded PDF in the catalog-datasheets Storage bucket
  // (migration 052), distinct from datasheetUrl which is just a pasted
  // external link -- a product can have either or both.
  datasheetStoragePath: string;
  // Migration 089 (Client Ledger): drives the auto-calculated target
  // replacement date on every installed_assets row referencing this item
  // (install_date + expectedLifespanYears). A real numeric column, not
  // folded into `specifications`, because EOL math needs to parse it
  // reliably -- null means "not set", the EOL tracker shows that plainly
  // rather than guessing a default.
  expectedLifespanYears: number | null;
};

type CatalogItemRow = {
  id: string;
  catalog_number: string;
  product_name: string;
  sales_description: string | null;
  technical_description: string | null;
  category: string | null;
  manufacturer: string | null;
  default_sell_price: number | string | null;
  cost_source: string | null;
  linked_reference: string | null;
  datasheet_url: string | null;
  image_url: string | null;
  is_retired: boolean | null;
  unit_cost: number | string | null;
  markup_percent: number | string | null;
  item_type: string | null;
  billing_frequency: string | null;
  bundle_components: string | null;
  height_in: string | null;
  width_in: string | null;
  pixel_pitch_mm: string | null;
  builtin_flasher_module: string | null;
  additional_space_multiplier: number | string | null;
  insert_quantity: number | string | null;
  tags: string[] | null;
  specifications: Record<string, string> | null;
  datasheet_storage_path: string | null;
  expected_lifespan_years: number | string | null;
};

function mapCatalogRow(row: CatalogItemRow): CatalogItem {
  return {
    id: row.id,
    catalogNumber: row.catalog_number,
    productName: row.product_name,
    salesDescription: row.sales_description ?? "",
    technicalDescription: row.technical_description ?? "",
    category: row.category ?? "",
    manufacturer: row.manufacturer ?? "",
    defaultSellPrice: Number(row.default_sell_price) || 0,
    costSource: (row.cost_source as CatalogItem["costSource"]) ?? "manual",
    linkedReference: row.linked_reference ?? "",
    datasheetUrl: row.datasheet_url ?? "",
    imageUrl: row.image_url ?? "",
    isRetired: Boolean(row.is_retired),
    unitCost: Number(row.unit_cost) || 0,
    markupPercent: Number(row.markup_percent) || 0,
    itemType: row.item_type === "bundle" ? "bundle" : "regular",
    billingFrequency: row.billing_frequency ?? "",
    bundleComponents: row.bundle_components ?? "",
    heightIn: row.height_in ?? "",
    widthIn: row.width_in ?? "",
    pixelPitchMm: row.pixel_pitch_mm ?? "",
    builtinFlasherModule: row.builtin_flasher_module ?? "",
    additionalSpaceMultiplier: row.additional_space_multiplier === null || row.additional_space_multiplier === undefined ? null : Number(row.additional_space_multiplier),
    insertQuantity: row.insert_quantity === null || row.insert_quantity === undefined ? null : Number(row.insert_quantity),
    tags: row.tags ?? [],
    specifications: row.specifications ?? {},
    datasheetStoragePath: row.datasheet_storage_path ?? "",
    expectedLifespanYears: row.expected_lifespan_years === null || row.expected_lifespan_years === undefined ? null : Number(row.expected_lifespan_years),
  };
}

function catalogItemWritePayload(item: Omit<CatalogItem, "id">) {
  return {
    catalog_number: item.catalogNumber,
    product_name: item.productName,
    sales_description: item.salesDescription,
    technical_description: item.technicalDescription,
    category: item.category,
    manufacturer: item.manufacturer,
    default_sell_price: item.defaultSellPrice,
    cost_source: item.costSource,
    linked_reference: item.linkedReference,
    datasheet_url: item.datasheetUrl,
    image_url: item.imageUrl,
    is_retired: item.isRetired,
    unit_cost: item.unitCost,
    markup_percent: item.markupPercent,
    item_type: item.itemType,
    billing_frequency: item.billingFrequency || null,
    bundle_components: item.bundleComponents || null,
    height_in: item.heightIn || null,
    width_in: item.widthIn || null,
    pixel_pitch_mm: item.pixelPitchMm || null,
    builtin_flasher_module: item.builtinFlasherModule || null,
    additional_space_multiplier: item.additionalSpaceMultiplier,
    insert_quantity: item.insertQuantity,
    tags: item.tags ?? [],
    specifications: item.specifications ?? {},
    datasheet_storage_path: item.datasheetStoragePath || null,
    expected_lifespan_years: item.expectedLifespanYears,
  };
}

export function makeCatalogNumber() {
  return `CAT-${Date.now().toString(36).toUpperCase()}`;
}

// Real Storage for catalog datasheets (migration 052) -- same
// upload-a-raw-file pattern as project-documents (see uploadDocumentFile
// above), but this bucket is public so a plain object URL works directly
// (no signed-URL round trip), since datasheets need to be linkable from
// client-facing Quotes/Submittals down the line.
const CATALOG_DATASHEET_BUCKET = "catalog-datasheets";

export function buildCatalogDatasheetStoragePath(catalogNumber: string, fileName: string): string {
  const stamp = Date.now().toString(36);
  return `${sanitizeStoragePathSegment(catalogNumber || "item")}/${stamp}-${sanitizeStoragePathSegment(fileName)}`;
}

export async function uploadCatalogDatasheetFile(file: File, storagePath: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
  const response = await fetch(
    `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/${CATALOG_DATASHEET_BUCKET}/${storagePath}`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": file.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: file,
    },
  );
  return response.ok;
}

export function getCatalogDatasheetPublicUrl(storagePath: string): string | null {
  if (!isRemotePersistenceConfigured() || !storagePath) {
    return null;
  }
  return `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/public/${CATALOG_DATASHEET_BUCKET}/${storagePath}`;
}

export async function loadCatalogItems(accessToken?: string): Promise<CatalogItem[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }

  const response = await fetch(supabaseUrl("product_catalog?select=*&order=product_name.asc"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as CatalogItemRow[];
  return rows.map(mapCatalogRow);
}

export async function createCatalogItem(item: Omit<CatalogItem, "id">, accessToken?: string): Promise<CatalogItem> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }

  const response = await fetch(supabaseUrl("product_catalog"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "return=representation",
    },
    body: JSON.stringify(catalogItemWritePayload(item)),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Could not create catalog item (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const rows = (await response.json()) as CatalogItemRow[];
  return mapCatalogRow(rows[0]);
}

export async function updateCatalogItem(id: string, item: Omit<CatalogItem, "id">, accessToken?: string): Promise<CatalogItem> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }

  const response = await fetch(supabaseUrl(`product_catalog?id=eq.${id}`), {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "return=representation",
    },
    body: JSON.stringify({
      ...catalogItemWritePayload(item),
      retired_at: item.isRetired ? new Date().toISOString() : null,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Could not update catalog item (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const rows = (await response.json()) as CatalogItemRow[];
  return mapCatalogRow(rows[0]);
}

// Bulk import from a spreadsheet (Phase 19-style, parsed entirely in the
// browser -- see SalesCatalog's handleCatalogFileSelect). One batched POST
// with an array body instead of one request per row.
export async function bulkCreateCatalogItems(
  items: Array<Omit<CatalogItem, "id" | "catalogNumber"> & { catalogNumber?: string }>,
  accessToken?: string,
): Promise<CatalogItem[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }
  if (items.length === 0) {
    return [];
  }

  const response = await fetch(supabaseUrl("product_catalog"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "return=representation",
    },
    body: JSON.stringify(
      items.map((item, index) =>
        catalogItemWritePayload({
          ...item,
          // makeCatalogNumber() is Date.now()-based; calling it synchronously
          // in a loop for a multi-row import produces the SAME value for
          // every row (ms resolution, hundreds of calls per ms), which
          // violates product_catalog.catalog_number's unique constraint and
          // silently fails the ENTIRE batched insert (Postgres rejects the
          // whole statement, so 0 rows land -- a bulk upload of hundreds of
          // items appears to "do nothing"). Suffix with the row index so
          // every row in a batch is guaranteed distinct, matching the
          // pattern already used by createProjectDocuments/createEquipment.
          catalogNumber: item.catalogNumber || `${makeCatalogNumber()}-${index}`,
        }),
      ),
    ),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Could not import catalog items (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const rows = (await response.json()) as CatalogItemRow[];
  return rows.map(mapCatalogRow);
}

export async function setCatalogItemRetired(id: string, retired: boolean, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const response = await fetch(supabaseUrl(`product_catalog?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      is_retired: retired,
      retired_at: retired ? new Date().toISOString() : null,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not update catalog item: ${response.status}`);
  }
  // A permissions-blocked PATCH still returns 200/204 with zero rows changed.
  const rows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error("That change didn't affect anything -- you may not have permission to edit the catalog.");
  }
}

// --- Catalog price-change approval workflow (migration 046) ---------------
// Product Catalog writes are admin/manager-only (migration 033's RLS), so a
// Sales rep proposing a cost/markup/price change has no direct write path
// to product_catalog -- this is that path instead. A manager or admin
// reviews the request; approving it applies the change to product_catalog
// using their own already-authorized write access (see
// approveCatalogPriceChangeRequest below).
export type CatalogPriceChangeField = "unit_cost" | "markup_percent" | "default_sell_price";

export type CatalogPriceChangeRequest = {
  id: string;
  catalogItemId: string;
  requestedByEmail: string;
  fieldChanged: CatalogPriceChangeField;
  previousValue: number;
  requestedValue: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewedByEmail: string;
  reviewedAt: string | null;
  createdAt: string;
};

type CatalogPriceChangeRequestRow = {
  id: string;
  catalog_item_id: string;
  requested_by_email: string;
  field_changed: CatalogPriceChangeField;
  previous_value: number | string;
  requested_value: number | string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  created_at: string;
};

function mapCatalogPriceChangeRequestRow(row: CatalogPriceChangeRequestRow): CatalogPriceChangeRequest {
  return {
    id: row.id,
    catalogItemId: row.catalog_item_id,
    requestedByEmail: row.requested_by_email,
    fieldChanged: row.field_changed,
    previousValue: Number(row.previous_value),
    requestedValue: Number(row.requested_value),
    reason: row.reason ?? "",
    status: row.status,
    reviewedByEmail: row.reviewed_by_email ?? "",
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

// RLS limits what comes back here to the caller's own requests plus, for an
// admin/manager, every request -- so this is safe to call for any signed-in
// user (a Sales rep sees the status of their own asks; a manager sees the
// full queue).
export async function loadCatalogPriceChangeRequests(accessToken?: string): Promise<CatalogPriceChangeRequest[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl("catalog_price_change_requests?select=*&order=created_at.desc"), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as CatalogPriceChangeRequestRow[];
  return rows.map(mapCatalogPriceChangeRequestRow);
}

export async function createCatalogPriceChangeRequest(
  input: { catalogItemId: string; requestedByEmail: string; fieldChanged: CatalogPriceChangeField; previousValue: number; requestedValue: number; reason: string },
  accessToken?: string,
): Promise<CatalogPriceChangeRequest | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const response = await fetch(supabaseUrl("catalog_price_change_requests"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      catalog_item_id: input.catalogItemId,
      requested_by_email: input.requestedByEmail,
      field_changed: input.fieldChanged,
      previous_value: input.previousValue,
      requested_value: input.requestedValue,
      reason: input.reason || null,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not submit price change request: ${response.status}`);
  }
  const rows = (await response.json()) as CatalogPriceChangeRequestRow[];
  return rows[0] ? mapCatalogPriceChangeRequestRow(rows[0]) : null;
}

// Approving is two writes: apply the requested value to product_catalog
// (the reviewer's own admin/manager write access, not the requester's),
// then mark the request approved. Not a real DB transaction, but consistent
// with how every other multi-step save in this app already works (e.g.
// task close/reopen, invite acceptance).
export async function approveCatalogPriceChangeRequest(request: CatalogPriceChangeRequest, reviewerEmail: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const columnByField: Record<CatalogPriceChangeField, string> = {
    unit_cost: "unit_cost",
    markup_percent: "markup_percent",
    default_sell_price: "default_sell_price",
  };
  const applyResponse = await fetch(supabaseUrl(`product_catalog?id=eq.${request.catalogItemId}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ [columnByField[request.fieldChanged]]: request.requestedValue }),
  });
  if (!applyResponse.ok) {
    throw new Error(`Could not apply the approved price change: ${applyResponse.status}`);
  }
  const appliedRows = (await applyResponse.json().catch(() => [])) as Array<{ id: string }>;
  if (appliedRows.length === 0) {
    throw new Error("The price change didn't apply -- you may not have permission to edit the catalog.");
  }
  const reviewResponse = await fetch(supabaseUrl(`catalog_price_change_requests?id=eq.${request.id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ status: "approved", reviewed_by_email: reviewerEmail, reviewed_at: new Date().toISOString() }),
  });
  if (!reviewResponse.ok) {
    throw new Error(`Price applied, but could not mark the request approved: ${reviewResponse.status}`);
  }
  const reviewRows = (await reviewResponse.json().catch(() => [])) as Array<{ id: string }>;
  if (reviewRows.length === 0) {
    throw new Error("Price applied, but marking the request approved didn't affect anything.");
  }
}

export async function rejectCatalogPriceChangeRequest(id: string, reviewerEmail: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const response = await fetch(supabaseUrl(`catalog_price_change_requests?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ status: "rejected", reviewed_by_email: reviewerEmail, reviewed_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    throw new Error(`Could not reject price change request: ${response.status}`);
  }
  const rows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error("That rejection didn't affect anything -- you may not have permission.");
  }
}

export type ApprovalStatus = "pending" | "approved" | "denied";

export type UserStatus = {
  userId: string;
  approvalStatus: ApprovalStatus;
  expiresAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  requestedAt: string;
  hasSeenWelcome: boolean;
};

type UserStatusRow = {
  user_id: string;
  approval_status: ApprovalStatus;
  expires_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  requested_at: string;
  has_seen_welcome: boolean;
};

function mapUserStatusRow(row: UserStatusRow): UserStatus {
  return {
    userId: row.user_id,
    approvalStatus: row.approval_status,
    expiresAt: row.expires_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    requestedAt: row.requested_at,
    hasSeenWelcome: row.has_seen_welcome,
  };
}

// Called once, when the first-login welcome slideshow finishes (or the
// person skips it) -- so it never shows again for that account.
export async function markWelcomeSeen(userId: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  await fetch(supabaseUrl(`app_user_status?user_id=eq.${userId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ has_seen_welcome: true }),
  }).catch(() => undefined);
}

// Creates a pending-approval row for the current user if one doesn't already
// exist. Safe to call every sign-in: with resolution=ignore-duplicates, an
// existing row for this user_id is silently skipped rather than erroring.
// Returns true only when this call actually created the row (a brand-new
// sign-up), which callers use to fire a one-time "new sign-up" notification
// to admins -- with ignore-duplicates, PostgREST returns an empty array
// (not the row) when the insert was skipped because the row already existed.
export async function ensureOwnApprovalRequest(userId: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }

  try {
    const response = await fetch(supabaseUrl("app_user_status"), {
      method: "POST",
      headers: {
        ...supabaseHeaders(accessToken),
        prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!response.ok) {
      return false;
    }
    const rows = (await response.json().catch(() => [])) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

// Admin emails to notify about admin-relevant events (e.g. a new sign-up
// landing in the pending-approval queue). Mirrors loadUsersByRole, but
// joins app_admins to app_known_users instead of app_user_roles since
// "admin" isn't a role_key -- see migration 049.
export async function loadAdminEmails(accessToken?: string): Promise<Array<{ userId: string; email: string }>> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }

  const response = await fetch(supabaseUrl("rpc/get_admin_emails"), {
    method: "POST",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as Array<{ user_id: string; email: string }>;
  return rows.map((row) => ({ userId: row.user_id, email: row.email }));
}

export async function loadOwnApprovalStatus(userId: string, accessToken?: string): Promise<UserStatus | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }

  const response = await fetch(supabaseUrl(`app_user_status?user_id=eq.${userId}&select=*`), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return null;
  }

  const rows = (await response.json()) as UserStatusRow[];
  return rows[0] ? mapUserStatusRow(rows[0]) : null;
}

export async function loadAllApprovalStatuses(accessToken?: string): Promise<UserStatus[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }

  const response = await fetch(supabaseUrl("app_user_status?select=*"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as UserStatusRow[];
  return rows.map(mapUserStatusRow);
}

export async function reviewUserApproval(
  targetUserId: string,
  approvalStatus: ApprovalStatus,
  reviewerUserId: string,
  expiresAt: string | null,
  accessToken?: string,
) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const response = await fetch(supabaseUrl(`app_user_status?user_id=eq.${targetUserId}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      approval_status: approvalStatus,
      expires_at: expiresAt,
      approved_by: reviewerUserId,
      approved_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Could not update approval status: ${response.status}`);
  }
  // A permissions-blocked PATCH still returns 200/204 with zero rows changed
  // -- an admin approving/denying a user needs to know if that actually
  // took effect, since it directly controls that person's access.
  const rows = (await response.json().catch(() => [])) as Array<{ user_id: string }>;
  if (rows.length === 0) {
    throw new Error("That approval change didn't affect anything -- you may not have permission.");
  }
}

// "sales" used to be one shared bucket for both the Product Catalog and the
// Quote Builder, which mixed unrelated requests together. Migration 034
// splits it into sales_catalog / sales_quotes (and reassigns any existing
// "sales" rows to sales_catalog) so each area's task panel only shows what's
// actually relevant to it.
export type TaskSection = "warehouse" | "purchasing" | "inventory" | "projects" | "sales_catalog" | "sales_quotes" | "engineering" | "general";
export type TaskStatus = "to_do" | "in_progress" | "ready_for_review" | "done" | "blocked";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export type EOTask = {
  id: string;
  taskNumber: string;
  title: string;
  description: string;
  section: TaskSection;
  projectRef: string;
  quoteId: string;
  isInternal: boolean;
  status: TaskStatus;
  priority: TaskPriority;
  category: string;
  impactAreas: string[];
  assigneeUserId: string | null;
  assigneeEmail: string;
  // Mutually exclusive with assigneeUserId/assigneeEmail (enforced
  // client-side): when set, the task belongs to everyone holding this role
  // rather than one person -- "if it's engineering, all the engineers
  // should receive the request" (migration 042).
  assignedRoleKey: string | null;
  startDate: string;
  dueDate: string;
  createdBy: string | null;
  createdByEmail: string;
  createdAt: string;
  completedAt: string | null;
  closedByEmail: string;
  closedAt: string;
  deletedByEmail: string;
  deletedAt: string;
};

type TaskRow = {
  id: string;
  task_number: string;
  title: string;
  description: string | null;
  section: TaskSection;
  project_ref: string | null;
  quote_id: string | null;
  is_internal: boolean;
  status: TaskStatus;
  priority: TaskPriority;
  category: string | null;
  impact_areas: string[] | null;
  assignee_user_id: string | null;
  assignee_email: string | null;
  assigned_role_key: string | null;
  start_date: string | null;
  due_date: string | null;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
  completed_at: string | null;
  closed_by_email: string | null;
  closed_at: string | null;
  deleted_by_email: string | null;
  deleted_at: string | null;
};

function mapTaskRow(row: TaskRow): EOTask {
  return {
    id: row.id,
    taskNumber: row.task_number,
    title: row.title,
    description: row.description ?? "",
    section: row.section,
    projectRef: row.project_ref ?? "",
    quoteId: row.quote_id ?? "",
    isInternal: row.is_internal,
    status: row.status,
    priority: row.priority,
    category: row.category ?? "",
    impactAreas: row.impact_areas ?? [],
    assigneeUserId: row.assignee_user_id,
    assigneeEmail: row.assignee_email ?? "",
    assignedRoleKey: row.assigned_role_key,
    startDate: row.start_date ?? "",
    dueDate: row.due_date ?? "",
    createdBy: row.created_by,
    createdByEmail: row.created_by_email ?? "",
    createdAt: row.created_at,
    completedAt: row.completed_at,
    closedByEmail: row.closed_by_email ?? "",
    closedAt: row.closed_at ?? "",
    deletedByEmail: row.deleted_by_email ?? "",
    deletedAt: row.deleted_at ?? "",
  };
}

export function makeTaskNumber() {
  return `TASK-${Date.now().toString(36).toUpperCase()}`;
}

export async function loadTasks(accessToken?: string): Promise<EOTask[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }

  // limit= added 2026-09-12 (overnight reliability closeout part 2, task
  // 7): this select had no cap at all -- unlike inventory_movements/
  // build_transactions/project_allocation_history (already limit=2000),
  // this one was missed. Same cap, same reasoning: newest-first, oldest
  // beyond the cap simply isn't loaded rather than the app fetching an
  // ever-growing full table on every load.
  const response = await fetch(supabaseUrl("tasks?select=*&deleted_at=is.null&order=created_at.desc&limit=2000"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as TaskRow[];
  return rows.map(mapTaskRow);
}

// Soft-deleted tasks -- kept for the Deleted Tasks review panel so who
// deleted what, and when, stays visible and reversible instead of vanishing
// the moment someone clicks Delete.
export async function loadDeletedTasks(accessToken?: string): Promise<EOTask[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }

  const response = await fetch(supabaseUrl("tasks?select=*&deleted_at=not.is.null&order=deleted_at.desc"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as TaskRow[];
  return rows.map(mapTaskRow);
}

export async function createTask(
  task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdByEmail" | "createdAt" | "completedAt" | "closedByEmail" | "closedAt" | "deletedByEmail" | "deletedAt">,
  createdBy: string,
  createdByEmail: string,
  accessToken?: string,
): Promise<EOTask> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }

  const response = await fetch(supabaseUrl("tasks"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "return=representation",
    },
    body: JSON.stringify({
      task_number: makeTaskNumber(),
      title: task.title,
      description: task.description,
      section: task.section,
      project_ref: task.projectRef || null,
      quote_id: task.quoteId || null,
      is_internal: task.isInternal,
      status: task.status,
      priority: task.priority,
      category: task.category,
      impact_areas: task.impactAreas,
      assignee_email: task.assigneeEmail || null,
      assigned_role_key: task.assignedRoleKey || null,
      start_date: task.startDate || null,
      due_date: task.dueDate || null,
      created_by: createdBy,
      created_by_email: createdByEmail || null,
    }),
  });

  if (!response.ok) {
    throw new Error(`Could not create task: ${response.status}`);
  }

  const rows = (await response.json()) as TaskRow[];
  return mapTaskRow(rows[0]);
}

export async function updateTask(id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>, accessToken?: string): Promise<EOTask> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }

  const payload: Record<string, unknown> = {};
  if (task.title !== undefined) payload.title = task.title;
  if (task.description !== undefined) payload.description = task.description;
  if (task.section !== undefined) payload.section = task.section;
  if (task.projectRef !== undefined) payload.project_ref = task.projectRef || null;
  if (task.quoteId !== undefined) payload.quote_id = task.quoteId || null;
  if (task.isInternal !== undefined) payload.is_internal = task.isInternal;
  if (task.status !== undefined) {
    payload.status = task.status;
    payload.completed_at = task.status === "done" ? new Date().toISOString() : null;
  }
  if (task.priority !== undefined) payload.priority = task.priority;
  if (task.category !== undefined) payload.category = task.category;
  if (task.impactAreas !== undefined) payload.impact_areas = task.impactAreas;
  if (task.assigneeEmail !== undefined) payload.assignee_email = task.assigneeEmail || null;
  if (task.assignedRoleKey !== undefined) payload.assigned_role_key = task.assignedRoleKey || null;
  if (task.startDate !== undefined) payload.start_date = task.startDate || null;
  if (task.dueDate !== undefined) payload.due_date = task.dueDate || null;
  if (task.closedByEmail !== undefined) payload.closed_by_email = task.closedByEmail || null;
  if (task.closedAt !== undefined) payload.closed_at = task.closedAt || null;
  if (task.deletedByEmail !== undefined) payload.deleted_by_email = task.deletedByEmail || null;
  if (task.deletedAt !== undefined) payload.deleted_at = task.deletedAt || null;

  const response = await fetch(supabaseUrl(`tasks?id=eq.${id}`), {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Could not update task: ${response.status}`);
  }

  const rows = (await response.json()) as TaskRow[];
  return mapTaskRow(rows[0]);
}

// Deleting a task is a soft delete (see updateTask's deletedByEmail/deletedAt
// handling above) -- there is deliberately no hard-delete function here.
// Hard-deleting would cascade-remove the task's own task_activity_log rows
// (migration 036's foreign key), destroying the exact audit trail this app
// was built to keep. "Delete" in the UI stamps who/when and hides the task
// from normal lists; it stays reviewable and restorable from the Deleted
// Tasks panel.

// Task audit trail (migration 036). One row per create/update/close/reopen,
// loaded per-task on demand when the Edit Task modal opens for an existing
// task -- append-only from the client (no update/delete policy), so this is
// a genuine, tamper-resistant "who changed what, when" log.
export type TaskActivityEntry = {
  id: string;
  taskId: string;
  actorEmail: string;
  message: string;
  createdAt: string;
};

type TaskActivityRow = {
  id: string;
  task_id: string;
  actor_email: string | null;
  message: string;
  created_at: string;
};

function mapTaskActivityRow(row: TaskActivityRow): TaskActivityEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    actorEmail: row.actor_email ?? "",
    message: row.message,
    createdAt: row.created_at,
  };
}

export async function loadTaskActivity(taskId: string, accessToken?: string): Promise<TaskActivityEntry[]> {
  if (!isRemotePersistenceConfigured() || !accessToken || !taskId) {
    return [];
  }

  const response = await fetch(supabaseUrl(`task_activity_log?select=*&task_id=eq.${taskId}&order=created_at.desc`), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as TaskActivityRow[];
  return rows.map(mapTaskActivityRow);
}

// Loads the entire log (every task) in one call -- simplest way to make
// per-task activity available to every place the Edit Task modal can be
// opened from (mini-panels across Sales/Purchasing/Inventory/Projects plus
// the full Tasks page) without a per-modal-open network round trip.
export async function loadAllTaskActivity(accessToken?: string): Promise<TaskActivityEntry[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }

  const response = await fetch(supabaseUrl("task_activity_log?select=*&order=created_at.desc"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as TaskActivityRow[];
  return rows.map(mapTaskActivityRow);
}

export async function addTaskActivity(taskId: string, actorEmail: string, message: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken || !taskId) {
    return;
  }

  // Best-effort by design (an audit-trail write alongside a task action
  // that's already succeeded, not the action itself) -- a logging failure
  // must never block the actual save. Previously swallowed both network
  // AND HTTP failures with zero signal (PRODUCT_ERROR_VISIBILITY_AUDIT.md
  // §7 documents this exact gap already firing in production once, a real
  // 503 on this endpoint noticed only by accident during unrelated manual
  // QA). Now at least logs a real failure instead of vanishing silently.
  try {
    const response = await fetch(supabaseUrl("task_activity_log"), {
      method: "POST",
      headers: supabaseHeaders(accessToken),
      body: JSON.stringify({ task_id: taskId, actor_email: actorEmail || null, message }),
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      console.error(`addTaskActivity failed for task ${taskId} (${response.status}): ${bodyText}`);
    }
  } catch (error) {
    console.error(`addTaskActivity network error for task ${taskId}:`, error);
  }
}

export type TeamMember = {
  id: string;
  fullName: string;
  email: string;
  roleTitle: string;
  isActive: boolean;
  primaryRole: string;
  secondaryRoles: string[];
  slackUserId: string;
  avatarUrl: string;
};

type TeamMemberRow = {
  id: string;
  full_name: string;
  email: string | null;
  role_title: string | null;
  is_active: boolean;
  primary_role: string | null;
  secondary_roles: string[] | null;
  slack_user_id: string | null;
  avatar_url?: string | null;
};

function mapTeamMemberRow(row: TeamMemberRow): TeamMember {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email ?? "",
    roleTitle: row.role_title ?? "",
    isActive: row.is_active,
    primaryRole: row.primary_role ?? "",
    secondaryRoles: row.secondary_roles ?? [],
    slackUserId: row.slack_user_id ?? "",
    avatarUrl: row.avatar_url ?? "",
  };
}

export async function loadTeamMembers(accessToken?: string): Promise<TeamMember[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }

  const response = await fetch(supabaseUrl("team_members?select=*&order=full_name.asc"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as TeamMemberRow[];
  return rows.map(mapTeamMemberRow);
}

export async function createTeamMember(member: Omit<TeamMember, "id">, accessToken?: string): Promise<TeamMember> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }

  const response = await fetch(supabaseUrl("team_members"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "return=representation",
    },
    body: JSON.stringify({
      full_name: member.fullName,
      email: member.email || null,
      role_title: member.roleTitle,
      is_active: member.isActive,
      primary_role: member.primaryRole || null,
      secondary_roles: member.secondaryRoles ?? [],
      slack_user_id: member.slackUserId || null,
      avatar_url: member.avatarUrl || null,
    }),
  });

  if (!response.ok) {
    throw new Error(`Could not add team member: ${response.status}`);
  }

  const rows = (await response.json()) as TeamMemberRow[];
  return mapTeamMemberRow(rows[0]);
}

export async function updateTeamMember(id: string, member: Partial<Omit<TeamMember, "id">>, accessToken?: string): Promise<TeamMember> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }

  const payload: Record<string, unknown> = {};
  if (member.fullName !== undefined) payload.full_name = member.fullName;
  if (member.email !== undefined) payload.email = member.email || null;
  if (member.roleTitle !== undefined) payload.role_title = member.roleTitle;
  if (member.isActive !== undefined) payload.is_active = member.isActive;
  if (member.primaryRole !== undefined) payload.primary_role = member.primaryRole || null;
  if (member.secondaryRoles !== undefined) payload.secondary_roles = member.secondaryRoles;
  if (member.slackUserId !== undefined) payload.slack_user_id = member.slackUserId || null;
  if (member.avatarUrl !== undefined) payload.avatar_url = member.avatarUrl || null;

  const response = await fetch(supabaseUrl(`team_members?id=eq.${id}`), {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Could not update team member: ${response.status}`);
  }

  const rows = (await response.json()) as TeamMemberRow[];
  return mapTeamMemberRow(rows[0]);
}

// The team roster (migration 019) is intentionally admin-maintained and NOT
// auto-populated from auth.users -- someone can be assigned tasks before
// they've ever logged in. That also means an admin who signs in for the
// first time has an empty Assignee dropdown, including for themselves,
// until someone manually adds them. This closes that gap: on every admin
// sign-in, check whether their own email is already on the roster and add
// it (with a best-effort display name from their email) only if it's
// missing -- never overwrites a name/title an admin already edited.
export async function ensureTeamMemberForSelf(email: string, fullNameGuess: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken || !email) {
    return;
  }
  try {
    const existingResponse = await fetch(supabaseUrl(`team_members?select=id&email=ilike.${encodeURIComponent(email)}&limit=1`), {
      headers: supabaseHeaders(accessToken),
    });
    if (existingResponse.ok) {
      const rows = (await existingResponse.json()) as Array<{ id: string }>;
      if (rows.length > 0) {
        return;
      }
    } else {
      // Correction (2026-09-11, review): this used to log the failed
      // lookup and then fall through to the INSERT anyway. Once the lookup
      // itself failed, this function has no idea whether the member
      // already exists -- proceeding risked a duplicate row (or a
      // confusing unique-constraint failure logged as if it were a fresh
      // insert problem). Stop here; stays best-effort/non-throwing, same
      // as before.
      console.error(`ensureTeamMemberForSelf: team_members lookup failed for ${email} (${existingResponse.status})`);
      return;
    }
    const insertResponse = await fetch(supabaseUrl("team_members"), {
      method: "POST",
      headers: supabaseHeaders(accessToken),
      body: JSON.stringify({ full_name: fullNameGuess, email, role_title: null, is_active: true }),
    });
    if (!insertResponse.ok) {
      console.error(`ensureTeamMemberForSelf: team_members insert failed for ${email} (${insertResponse.status})`);
    }
  } catch (error) {
    // Best-effort convenience only -- if this fails (e.g. a race with
    // another tab, or RLS denies a non-admin/manager), the person can
    // still be added manually from Team Roster. Overnight audit
    // (2026-09-11, task 2): now logs instead of vanishing completely;
    // the best-effort/never-throws contract is unchanged.
    console.error(`ensureTeamMemberForSelf network error for ${email}:`, error);
  }
}

export type NotificationItem = {
  id: string;
  recipientEmail: string;
  eventType: string;
  title: string;
  body: string;
  relatedEntityType: string;
  relatedEntityId: string;
  isRead: boolean;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  recipient_email: string;
  event_type: string;
  title: string;
  body: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  is_read: boolean;
  created_at: string;
};

function mapNotificationRow(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    recipientEmail: row.recipient_email,
    eventType: row.event_type,
    title: row.title,
    body: row.body ?? "",
    relatedEntityType: row.related_entity_type ?? "",
    relatedEntityId: row.related_entity_id ?? "",
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

export async function loadNotifications(email: string, accessToken?: string): Promise<NotificationItem[]> {
  if (!isRemotePersistenceConfigured() || !accessToken || !email) {
    return [];
  }

  const response = await fetch(supabaseUrl(`notifications?recipient_email=eq.${encodeURIComponent(email)}&select=*&order=created_at.desc&limit=50`), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as NotificationRow[];
  return rows.map(mapNotificationRow);
}

// createNotification() (a direct client-token POST to `notifications`)
// was removed 2026-09-08 -- HANDOFF Questions/Decisions #9. It was the
// exact hole that let any signed-in user insert a `notifications` row
// addressed to anyone, with any event_type/title/body, protected only by
// an INSERT policy of `with check (true)`. All notification creation now
// goes through the server-controlled POST /api/create-notification
// (main.tsx's triggerNotification()), which independently re-derives
// recipient(s) and content from real stored data per event type -- see
// api/_lib/notificationEvents.js. Deliberately not kept around as a
// "fallback": migration 114 removes the direct-insert RLS policy this
// function relied on, so keeping the function would just be dead code
// pointing at a write path that no longer works.

// Audit trail for non-in-app delivery attempts (migration 024's
// notification_deliveries table) -- one row per channel per notification,
// so "did the email actually go out" is a real, reviewable fact instead of
// a guess.
export async function recordNotificationDelivery(
  notificationId: string,
  channel: "email" | "slack" | "teams" | "push",
  status: "sent" | "failed" | "skipped",
  errorMessage?: string,
  accessToken?: string,
) {
  if (!isRemotePersistenceConfigured() || !accessToken || !notificationId) {
    return;
  }

  // Best-effort by design (a telemetry write alongside a notification
  // that's already been sent/attempted, not the notification itself) --
  // stays fire-and-forget/never-throws for the caller. Previously
  // swallowed both network AND HTTP failures with zero signal at all
  // (PRODUCT_ERROR_VISIBILITY_AUDIT.md Addendum 2 -- this is the very
  // telemetry a future System Health screen would read, so a silent gap
  // here would look identical to "nothing failed"). Now at least logs a
  // real failure to the console; does not change recipients, routing,
  // dedup, or delivery rules, and still never blocks or fails the actual
  // send this call is recording the outcome of.
  try {
    const response = await fetch(supabaseUrl("notification_deliveries"), {
      method: "POST",
      headers: supabaseHeaders(accessToken),
      body: JSON.stringify({ notification_id: notificationId, channel, status, error_message: errorMessage || null }),
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      console.error(`recordNotificationDelivery failed for notification ${notificationId} (${channel}) (${response.status}): ${bodyText}`);
    }
  } catch (error) {
    console.error(`recordNotificationDelivery network error for notification ${notificationId} (${channel}):`, error);
  }
}

// Reviewed 2026-09-12 (overnight reliability closeout part 2, task 2):
// logging-only, deliberately non-throwing -- both callers
// (handleMarkNotificationRead/handleMarkAllNotificationsRead, main.tsx)
// already wrap this call in an explicit `.catch(() => {})`, so a real
// failure only ever logged silently before; this makes it visible in the
// console without changing either caller's optimistic-update behavior.
export async function markNotificationRead(id: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const response = await fetch(supabaseUrl(`notifications?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ is_read: true }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`markNotificationRead: PATCH failed for notification ${id} (${response.status}): ${bodyText}`);
  }
}

export async function markAllNotificationsRead(email: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken || !email) {
    return;
  }

  const response = await fetch(supabaseUrl(`notifications?recipient_email=eq.${encodeURIComponent(email)}&is_read=eq.false`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ is_read: true }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`markAllNotificationsRead: PATCH failed for ${email} (${response.status}): ${bodyText}`);
  }
}

export type NotificationRule = {
  id: string;
  eventType: string;
  channels: string[];
  isActive: boolean;
};

type NotificationRuleRow = {
  id: string;
  event_type: string;
  channels: string[] | null;
  is_active: boolean;
};

function mapNotificationRuleRow(row: NotificationRuleRow): NotificationRule {
  return {
    id: row.id,
    eventType: row.event_type,
    channels: row.channels ?? [],
    isActive: row.is_active,
  };
}

export async function loadNotificationRules(accessToken?: string): Promise<NotificationRule[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }

  const response = await fetch(supabaseUrl("notification_rules?select=*&order=event_type.asc"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as NotificationRuleRow[];
  return rows.map(mapNotificationRuleRow);
}

export async function updateNotificationRule(id: string, patch: Partial<Pick<NotificationRule, "channels" | "isActive">>, accessToken?: string): Promise<NotificationRule> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }

  const payload: Record<string, unknown> = {};
  if (patch.channels !== undefined) payload.channels = patch.channels;
  if (patch.isActive !== undefined) payload.is_active = patch.isActive;

  const response = await fetch(supabaseUrl(`notification_rules?id=eq.${id}`), {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Could not update notification rule: ${response.status}`);
  }

  const rows = (await response.json()) as NotificationRuleRow[];
  return mapNotificationRuleRow(rows[0]);
}

export type StandardInstallTime = {
  id: string;
  category: string;
  hoursPerUnit: number;
  notes: string;
};

type StandardInstallTimeRow = {
  id: string;
  category: string | null;
  hours_per_unit: number | string;
  notes: string | null;
};

function mapStandardInstallTimeRow(row: StandardInstallTimeRow): StandardInstallTime {
  return {
    id: row.id,
    category: row.category ?? "",
    hoursPerUnit: Number(row.hours_per_unit) || 0,
    notes: row.notes ?? "",
  };
}

export async function loadStandardInstallTimes(accessToken?: string): Promise<StandardInstallTime[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl("standard_install_times?select=id,category,hours_per_unit,notes&order=category.asc"), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as StandardInstallTimeRow[];
  return rows.map(mapStandardInstallTimeRow);
}

export async function upsertStandardInstallTime(entry: Omit<StandardInstallTime, "id">, accessToken?: string): Promise<StandardInstallTime> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }
  const response = await fetch(supabaseUrl("standard_install_times?on_conflict=category"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({ category: entry.category, hours_per_unit: entry.hoursPerUnit, notes: entry.notes }),
  });
  if (!response.ok) {
    throw new Error(`Could not save standard install time: ${response.status}`);
  }
  const rows = (await response.json()) as StandardInstallTimeRow[];
  return mapStandardInstallTimeRow(rows[0]);
}

export type ScheduleTemplatePhase = {
  id: string;
  templateId: string;
  phaseName: string;
  sequenceOrder: number;
  durationMode: "fixed_hours" | "per_bom_unit";
  fixedHours: number | null;
  bomCategoryFilter: string;
  defaultRole: string;
};

export type ScheduleTemplate = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  phases: ScheduleTemplatePhase[];
};

type ScheduleTemplateRow = { id: string; name: string; description: string | null; is_active: boolean };
type ScheduleTemplatePhaseRow = {
  id: string;
  template_id: string;
  phase_name: string;
  sequence_order: number;
  duration_mode: "fixed_hours" | "per_bom_unit";
  fixed_hours: number | string | null;
  bom_category_filter: string | null;
  default_role: string | null;
};

function mapPhaseRow(row: ScheduleTemplatePhaseRow): ScheduleTemplatePhase {
  return {
    id: row.id,
    templateId: row.template_id,
    phaseName: row.phase_name,
    sequenceOrder: row.sequence_order,
    durationMode: row.duration_mode,
    fixedHours: row.fixed_hours === null ? null : Number(row.fixed_hours),
    bomCategoryFilter: row.bom_category_filter ?? "",
    defaultRole: row.default_role ?? "",
  };
}

export async function loadScheduleTemplates(accessToken?: string): Promise<ScheduleTemplate[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const [templatesRes, phasesRes] = await Promise.all([
    fetch(supabaseUrl("project_schedule_templates?select=*&order=name.asc"), { headers: supabaseHeaders(accessToken) }),
    fetchWithDeletedAtFallback(supabaseUrl("project_schedule_template_phases?select=*&deleted_at=is.null&order=sequence_order.asc"), supabaseHeaders(accessToken)),
  ]);
  if (!templatesRes.ok || !phasesRes.ok) {
    return [];
  }
  const templateRows = (await templatesRes.json()) as ScheduleTemplateRow[];
  const phaseRows = (await phasesRes.json()) as ScheduleTemplatePhaseRow[];
  return templateRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    isActive: row.is_active,
    phases: phaseRows.filter((phase) => phase.template_id === row.id).map(mapPhaseRow),
  }));
}

export async function createScheduleTemplate(name: string, description: string, accessToken?: string): Promise<ScheduleTemplate> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }
  const response = await fetch(supabaseUrl("project_schedule_templates"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ name, description, is_active: true }),
  });
  if (!response.ok) {
    throw new Error(`Could not create template: ${response.status}`);
  }
  const rows = (await response.json()) as ScheduleTemplateRow[];
  return { id: rows[0].id, name: rows[0].name, description: rows[0].description ?? "", isActive: rows[0].is_active, phases: [] };
}

export async function addScheduleTemplatePhase(
  templateId: string,
  phase: Omit<ScheduleTemplatePhase, "id" | "templateId">,
  accessToken?: string,
): Promise<ScheduleTemplatePhase> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }
  const response = await fetch(supabaseUrl("project_schedule_template_phases"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      template_id: templateId,
      phase_name: phase.phaseName,
      sequence_order: phase.sequenceOrder,
      duration_mode: phase.durationMode,
      fixed_hours: phase.fixedHours,
      bom_category_filter: phase.bomCategoryFilter || null,
      default_role: phase.defaultRole || null,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not add phase: ${response.status}`);
  }
  const rows = (await response.json()) as ScheduleTemplatePhaseRow[];
  return mapPhaseRow(rows[0]);
}

export async function deleteScheduleTemplatePhase(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`project_schedule_template_phases?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete phase") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("schedule_template_phase", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

// --- Phase 11: Submittals -------------------------------------------------
// Client review/approval happens with no login via two security-definer RPCs
// (get_submittal_by_token / respond_to_submittal) exposed to the anon role.
// supabaseHeaders() with no accessToken already falls back to the anon key
// for both apikey and authorization, so the public functions below need no
// special-casing beyond simply not passing a token.

export type SubmittalSowSnapshot = {
  summary: string;
  preparation: string;
  infrastructure: string;
  installation: string;
  commissioning: string;
  fineTuning: string;
  assumptions: string;
  exclusions: string;
};

export type SubmittalBomLineSnapshot = { item: string; qty: number; status: string };

export type SubmittalSnapshot = {
  projectName: string;
  projectRef: string;
  clientName: string;
  siteAddress: string;
  targetDate: string;
  allocated: number;
  sow: SubmittalSowSnapshot;
  bom: SubmittalBomLineSnapshot[];
};

export type ProjectSubmittal = {
  id: string;
  projectId: string;
  version: number;
  status: "draft" | "sent" | "approved" | "rejected" | "revision_requested";
  contentSnapshot: SubmittalSnapshot;
  clientName: string;
  clientEmail: string;
  sentAt: string | null;
  respondedAt: string | null;
  responseNotes: string;
  approvalName: string;
  shareToken: string | null;
  createdAt: string;
};

export type PublicSubmittalView = {
  submittalId: string;
  status: ProjectSubmittal["status"];
  version: number;
  contentSnapshot: SubmittalSnapshot;
  clientName: string;
  projectName: string;
  // Added by migration 122 -- lets the public page show "This submittal
  // was approved on <date>" with real data instead of a bare status.
  respondedAt: string | null;
  approvalName: string | null;
};

// Migration 122: same discriminated-outcome shape as the proposal fix
// (migrations 119/121) -- see PRODUCT_TOKEN_BACKUP_CONTENT_TEST_AUDIT.md.
export type PublicSubmittalResult =
  | { outcome: "found"; data: PublicSubmittalView }
  | { outcome: "invalid_token" }
  | { outcome: "error" };

export type SubmittalResponseOutcome = "success" | "already_responded" | "invalid_token" | "error";

// Always carries the AUTHORITATIVE current state of the submittal, even
// when outcome is "already_responded" -- the caller should render this
// state directly rather than treating a non-"success" outcome as a bare
// failure.
export type SubmittalResponseResult = {
  outcome: SubmittalResponseOutcome;
  status: ProjectSubmittal["status"] | null;
  respondedAt: string | null;
  approvalName: string | null;
  version: number | null;
};

type ProjectSubmittalRow = {
  id: string;
  project_id: string;
  version: number;
  status: string;
  content_snapshot: SubmittalSnapshot;
  client_name: string | null;
  client_email: string | null;
  sent_at: string | null;
  responded_at: string | null;
  response_notes: string | null;
  approval_name: string | null;
  created_at: string;
};

type ShareTokenRow = { token: string; entity_id: string };

function mapSubmittalRow(row: ProjectSubmittalRow, shareToken: string | null): ProjectSubmittal {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    status: row.status as ProjectSubmittal["status"],
    contentSnapshot: row.content_snapshot,
    clientName: row.client_name ?? "",
    clientEmail: row.client_email ?? "",
    sentAt: row.sent_at,
    respondedAt: row.responded_at,
    responseNotes: row.response_notes ?? "",
    approvalName: row.approval_name ?? "",
    shareToken,
    createdAt: row.created_at,
  };
}

function generateShareToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

// Phase 10's app-code cutover hasn't happened yet, so ProjectSite objects in
// the app have no relational `projects.id`. This resolves (or lazily
// creates) the row by the natural `project_name` key so Submittals can link
// to a real project_id without waiting on the full cutover.
export async function resolveProjectId(projectName: string, accessToken?: string): Promise<string | null> {
  if (!isRemotePersistenceConfigured() || !accessToken || !projectName) {
    return null;
  }

  const existing = await fetch(supabaseUrl(`projects?project_name=eq.${encodeURIComponent(projectName)}&select=id&limit=1`), {
    headers: supabaseHeaders(accessToken),
  });

  if (existing.ok) {
    const rows = (await existing.json()) as Array<{ id: string }>;
    if (rows.length) {
      return rows[0].id;
    }
  }

  const created = await fetch(supabaseUrl("projects"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ project_name: projectName }),
  });

  if (!created.ok) {
    return null;
  }

  const rows = (await created.json()) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

export async function loadSubmittalsForProject(projectId: string, accessToken?: string): Promise<ProjectSubmittal[]> {
  if (!isRemotePersistenceConfigured() || !accessToken || !projectId) {
    return [];
  }

  const [submittalsRes, tokensRes] = await Promise.all([
    fetch(supabaseUrl(`project_submittals?project_id=eq.${projectId}&select=*&order=version.desc`), {
      headers: supabaseHeaders(accessToken),
    }),
    fetch(supabaseUrl(`public_share_tokens?entity_type=eq.project_submittal&select=token,entity_id`), {
      headers: supabaseHeaders(accessToken),
    }),
  ]);

  if (!submittalsRes.ok) {
    return [];
  }

  const rows = (await submittalsRes.json()) as ProjectSubmittalRow[];
  const tokenRows = tokensRes.ok ? ((await tokensRes.json()) as ShareTokenRow[]) : [];
  return rows.map((row) => mapSubmittalRow(row, tokenRows.find((entry) => entry.entity_id === row.id)?.token ?? null));
}

export async function createSubmittal(
  input: { projectId: string; version: number; contentSnapshot: SubmittalSnapshot; clientName: string; clientEmail: string },
  accessToken?: string,
): Promise<ProjectSubmittal> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }

  const response = await fetch(supabaseUrl("project_submittals"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      project_id: input.projectId,
      version: input.version,
      status: "sent",
      content_snapshot: input.contentSnapshot,
      client_name: input.clientName || null,
      client_email: input.clientEmail || null,
      sent_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Could not create submittal: ${response.status}`);
  }

  const rows = (await response.json()) as ProjectSubmittalRow[];
  return mapSubmittalRow(rows[0], null);
}

export async function createSubmittalShareToken(submittalId: string, accessToken?: string): Promise<string> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }

  const token = generateShareToken();
  const response = await fetch(supabaseUrl("public_share_tokens"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ token, entity_type: "project_submittal", entity_id: submittalId }),
  });

  if (!response.ok) {
    throw new Error(`Could not create share link: ${response.status}`);
  }

  return token;
}

export async function fetchPublicSubmittal(token: string): Promise<PublicSubmittalResult> {
  if (!isRemotePersistenceConfigured() || !token) {
    return { outcome: "error" };
  }
  let response: Response;
  try {
    response = await fetch(supabaseUrl("rpc/get_submittal_by_token"), {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({ share_token: token }),
    });
  } catch {
    return { outcome: "error" };
  }
  if (!response.ok) {
    return { outcome: "error" };
  }

  const rows = (await response.json()) as Array<{
    submittal_id: string;
    status: string;
    version: number;
    content_snapshot: SubmittalSnapshot;
    client_name: string | null;
    project_name: string;
    responded_at: string | null;
    approval_name: string | null;
  }>;

  if (!rows.length) {
    // A well-formed request that resolved zero rows means the token
    // itself doesn't match a live, unexpired submittal -- distinct from
    // a network/server failure (see migration 122, get_submittal_by_token).
    return { outcome: "invalid_token" };
  }

  const row = rows[0];
  return {
    outcome: "found",
    data: {
      submittalId: row.submittal_id,
      status: row.status as ProjectSubmittal["status"],
      version: row.version,
      contentSnapshot: row.content_snapshot,
      clientName: row.client_name ?? "",
      projectName: row.project_name,
      respondedAt: row.responded_at,
      approvalName: row.approval_name,
    },
  };
}

export async function respondToPublicSubmittal(
  token: string,
  newStatus: "approved" | "rejected" | "revision_requested",
  approverName: string,
  notes: string,
): Promise<SubmittalResponseResult> {
  const failed: SubmittalResponseResult = { outcome: "error", status: null, respondedAt: null, approvalName: null, version: null };
  if (!isRemotePersistenceConfigured() || !token) {
    return failed;
  }
  let response: Response;
  try {
    response = await fetch(supabaseUrl("rpc/respond_to_submittal"), {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({
        share_token: token,
        new_status: newStatus,
        approver_name: approverName || "Unknown",
        approver_ip: "",
        notes: notes || "",
      }),
    });
  } catch {
    return failed;
  }
  if (!response.ok) {
    return failed;
  }

  const rows = (await response.json()) as Array<{
    outcome: string;
    status: string | null;
    responded_at: string | null;
    approval_name: string | null;
    version: number | null;
  }>;
  if (!rows.length) {
    return failed;
  }
  const row = rows[0];
  return {
    outcome: (["success", "already_responded", "invalid_token"] as string[]).includes(row.outcome)
      ? (row.outcome as SubmittalResponseOutcome)
      : "error",
    status: (row.status as ProjectSubmittal["status"] | null) ?? null,
    respondedAt: row.responded_at,
    approvalName: row.approval_name,
    version: row.version,
  };
}

// --- Phase 18: Fluid Forms Engine + Handovers ------------------------------

export type FormSchemaField = {
  id: string;
  formSchemaId: string;
  section: string;
  fieldKey: string;
  label: string;
  fieldType: "text" | "textarea" | "number" | "select" | "checkbox" | "date";
  placeholder: string;
  isRequired: boolean;
  options: string[];
  sequenceOrder: number;
};

export type FormSchema = {
  id: string;
  formKey: string;
  name: string;
  description: string;
  isActive: boolean;
  fields: FormSchemaField[];
};

type FormSchemaRow = { id: string; form_key: string; name: string; description: string | null; is_active: boolean };
type FormSchemaFieldRow = {
  id: string;
  form_schema_id: string;
  section: string;
  field_key: string;
  label: string;
  field_type: FormSchemaField["fieldType"];
  placeholder: string | null;
  is_required: boolean;
  options: string[] | null;
  sequence_order: number;
};

function mapFormSchemaFieldRow(row: FormSchemaFieldRow): FormSchemaField {
  return {
    id: row.id,
    formSchemaId: row.form_schema_id,
    section: row.section,
    fieldKey: row.field_key,
    label: row.label,
    fieldType: row.field_type,
    placeholder: row.placeholder ?? "",
    isRequired: row.is_required,
    options: row.options ?? [],
    sequenceOrder: row.sequence_order,
  };
}

export async function loadFormSchema(formKey: string, accessToken?: string): Promise<FormSchema | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }

  const schemaRes = await fetch(supabaseUrl(`form_schemas?form_key=eq.${encodeURIComponent(formKey)}&select=*&limit=1`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!schemaRes.ok) {
    return null;
  }
  const schemaRows = (await schemaRes.json()) as FormSchemaRow[];
  if (!schemaRows.length) {
    return null;
  }
  const schema = schemaRows[0];

  const fieldsRes = await fetchWithDeletedAtFallback(
    supabaseUrl(`form_schema_fields?form_schema_id=eq.${schema.id}&select=*&deleted_at=is.null&order=sequence_order.asc`),
    supabaseHeaders(accessToken),
  );
  const fieldRows = fieldsRes.ok ? ((await fieldsRes.json()) as FormSchemaFieldRow[]) : [];

  return {
    id: schema.id,
    formKey: schema.form_key,
    name: schema.name,
    description: schema.description ?? "",
    isActive: schema.is_active,
    fields: fieldRows.map(mapFormSchemaFieldRow),
  };
}

export async function addFormSchemaField(
  formSchemaId: string,
  field: Omit<FormSchemaField, "id" | "formSchemaId">,
  accessToken?: string,
): Promise<FormSchemaField> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }
  const response = await fetch(supabaseUrl("form_schema_fields"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      form_schema_id: formSchemaId,
      section: field.section || "general",
      field_key: field.fieldKey,
      label: field.label,
      field_type: field.fieldType,
      placeholder: field.placeholder || null,
      is_required: field.isRequired,
      options: field.options,
      sequence_order: field.sequenceOrder,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not add form field: ${response.status}`);
  }
  const rows = (await response.json()) as FormSchemaFieldRow[];
  return mapFormSchemaFieldRow(rows[0]);
}

export async function updateFormSchemaField(
  id: string,
  patch: Partial<Omit<FormSchemaField, "id" | "formSchemaId">>,
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (patch.section !== undefined) payload.section = patch.section;
  if (patch.fieldKey !== undefined) payload.field_key = patch.fieldKey;
  if (patch.label !== undefined) payload.label = patch.label;
  if (patch.fieldType !== undefined) payload.field_type = patch.fieldType;
  if (patch.placeholder !== undefined) payload.placeholder = patch.placeholder || null;
  if (patch.isRequired !== undefined) payload.is_required = patch.isRequired;
  if (patch.options !== undefined) payload.options = patch.options;
  if (patch.sequenceOrder !== undefined) payload.sequence_order = patch.sequenceOrder;

  // Overnight audit (2026-09-11, task 2): this PATCH was completely
  // unchecked. Safe to verify here -- both callers (handleUpdateFormField/
  // handleUpdateSiteIntakeField) apply their local state update only AFTER
  // this call resolves (not optimistically before it), so a throw here
  // naturally prevents the local edit from ghost-applying, and both were
  // wrapped in a try/catch matching their sibling "add" handler's existing
  // status-message pattern in the same pass.
  const response = await fetch(supabaseUrl(`form_schema_fields?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateFormSchemaField failed for field ${id} (${response.status}): ${bodyText}`);
    throw new Error("Could not save this change.");
  }
  const rows = (await response.json().catch(() => [])) as unknown[];
  if (rows.length === 0) {
    console.error(`updateFormSchemaField affected 0 rows for field ${id} -- likely blocked by RLS or a missing field.`);
    throw new Error("Could not save this change.");
  }
}

export async function deleteFormSchemaField(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`form_schema_fields?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete field") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("form_schema_field", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

export type ProjectHandover = {
  id: string;
  projectId: string;
  formSchemaId: string;
  status: "draft" | "submitted";
  responses: Record<string, string>;
  submittedByEmail: string;
  submittedAt: string | null;
  createdAt: string;
};

type ProjectHandoverRow = {
  id: string;
  project_id: string;
  form_schema_id: string;
  status: string;
  responses: Record<string, string>;
  submitted_by_email: string | null;
  submitted_at: string | null;
  created_at: string;
};

function mapHandoverRow(row: ProjectHandoverRow): ProjectHandover {
  return {
    id: row.id,
    projectId: row.project_id,
    formSchemaId: row.form_schema_id,
    status: row.status as ProjectHandover["status"],
    responses: row.responses ?? {},
    submittedByEmail: row.submitted_by_email ?? "",
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
  };
}

export async function loadHandoversForProject(projectId: string, accessToken?: string): Promise<ProjectHandover[]> {
  if (!isRemotePersistenceConfigured() || !accessToken || !projectId) {
    return [];
  }
  const response = await fetch(
    supabaseUrl(`project_handovers?project_id=eq.${projectId}&select=*&order=created_at.desc`),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as ProjectHandoverRow[];
  return rows.map(mapHandoverRow);
}

export async function createHandover(projectId: string, formSchemaId: string, accessToken?: string): Promise<ProjectHandover> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }
  const response = await fetch(supabaseUrl("project_handovers"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ project_id: projectId, form_schema_id: formSchemaId, status: "draft", responses: {} }),
  });
  if (!response.ok) {
    throw new Error(`Could not create handover: ${response.status}`);
  }
  const rows = (await response.json()) as ProjectHandoverRow[];
  return mapHandoverRow(rows[0]);
}

export async function updateHandoverResponses(id: string, responses: Record<string, string>, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`project_handovers?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ responses }),
  });
}

export async function submitHandover(id: string, submittedByEmail: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`project_handovers?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ status: "submitted", submitted_by_email: submittedByEmail, submitted_at: new Date().toISOString() }),
  });
}

// --- Phase 20: Pre-Sales Hardware Rules Engine -----------------------------

export type PresalesHardwareRule = {
  id: string;
  tier: string;
  baseItemName: string;
  quantityMode: "fixed" | "per_node_ceil";
  fixedQty: number;
  perNodeDivisor: number | null;
  requiresCloudSync: boolean | null;
  sequenceOrder: number;
  isActive: boolean;
};

type PresalesHardwareRuleRow = {
  id: string;
  tier: string;
  base_item_name: string;
  quantity_mode: PresalesHardwareRule["quantityMode"];
  fixed_qty: number | string;
  per_node_divisor: number | string | null;
  requires_cloud_sync: boolean | null;
  sequence_order: number;
  is_active: boolean;
};

function mapPresalesRuleRow(row: PresalesHardwareRuleRow): PresalesHardwareRule {
  return {
    id: row.id,
    tier: row.tier,
    baseItemName: row.base_item_name,
    quantityMode: row.quantity_mode,
    fixedQty: Number(row.fixed_qty),
    perNodeDivisor: row.per_node_divisor === null ? null : Number(row.per_node_divisor),
    requiresCloudSync: row.requires_cloud_sync,
    sequenceOrder: row.sequence_order,
    isActive: row.is_active,
  };
}

export async function loadPresalesRules(accessToken?: string): Promise<PresalesHardwareRule[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetchWithDeletedAtFallback(supabaseUrl("presales_hardware_rules?select=*&deleted_at=is.null&order=tier.asc,sequence_order.asc"), supabaseHeaders(accessToken));
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as PresalesHardwareRuleRow[];
  return rows.map(mapPresalesRuleRow);
}

export async function createPresalesRule(rule: Omit<PresalesHardwareRule, "id">, accessToken?: string): Promise<PresalesHardwareRule> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }
  const response = await fetch(supabaseUrl("presales_hardware_rules"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      tier: rule.tier,
      base_item_name: rule.baseItemName,
      quantity_mode: rule.quantityMode,
      fixed_qty: rule.fixedQty,
      per_node_divisor: rule.perNodeDivisor,
      requires_cloud_sync: rule.requiresCloudSync,
      sequence_order: rule.sequenceOrder,
      is_active: rule.isActive,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not add rule: ${response.status}`);
  }
  const rows = (await response.json()) as PresalesHardwareRuleRow[];
  return mapPresalesRuleRow(rows[0]);
}

export async function deletePresalesRule(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`presales_hardware_rules?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete rule") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("presales_hardware_rule", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

// --- Site Builder hardware recommendation engine (v1, migration 045) ------
// A different shape from PresalesHardwareRule above: a Site Builder
// location has no "tier" or node count, just FLI/LPR/People Counting
// checkboxes and entry/exit/level counts, so each rule maps one of those
// "metrics" to a recommended quantity of an item. The app evaluates these
// live per location (see main.tsx's computeLocationHardware) -- nothing
// about the recommendation itself is persisted per-quote.
export type SiteHardwareMetric = "fli" | "lpr" | "people_counting" | "per_entry" | "per_exit" | "per_level";

export type SiteHardwareRule = {
  id: string;
  metric: SiteHardwareMetric;
  itemName: string;
  qtyPerUnit: number;
  notes: string;
  sequenceOrder: number;
  isActive: boolean;
};

type SiteHardwareRuleRow = {
  id: string;
  metric: SiteHardwareMetric;
  item_name: string;
  qty_per_unit: number | string;
  notes: string | null;
  sequence_order: number;
  is_active: boolean;
};

function mapSiteHardwareRuleRow(row: SiteHardwareRuleRow): SiteHardwareRule {
  return {
    id: row.id,
    metric: row.metric,
    itemName: row.item_name,
    qtyPerUnit: Number(row.qty_per_unit),
    notes: row.notes ?? "",
    sequenceOrder: row.sequence_order,
    isActive: row.is_active,
  };
}

export async function loadSiteHardwareRules(accessToken?: string): Promise<SiteHardwareRule[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetchWithDeletedAtFallback(supabaseUrl("site_hardware_rules?select=*&deleted_at=is.null&order=metric.asc,sequence_order.asc"), supabaseHeaders(accessToken));
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as SiteHardwareRuleRow[];
  return rows.map(mapSiteHardwareRuleRow);
}

export async function createSiteHardwareRule(rule: Omit<SiteHardwareRule, "id">, accessToken?: string): Promise<SiteHardwareRule> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }
  const response = await fetch(supabaseUrl("site_hardware_rules"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      metric: rule.metric,
      item_name: rule.itemName,
      qty_per_unit: rule.qtyPerUnit,
      notes: rule.notes || null,
      sequence_order: rule.sequenceOrder,
      is_active: rule.isActive,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not add rule: ${response.status}`);
  }
  const rows = (await response.json()) as SiteHardwareRuleRow[];
  return mapSiteHardwareRuleRow(rows[0]);
}

export async function updateSiteHardwareRule(id: string, patch: Partial<Omit<SiteHardwareRule, "id">>, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (patch.metric !== undefined) payload.metric = patch.metric;
  if (patch.itemName !== undefined) payload.item_name = patch.itemName;
  if (patch.qtyPerUnit !== undefined) payload.qty_per_unit = patch.qtyPerUnit;
  if (patch.notes !== undefined) payload.notes = patch.notes || null;
  if (patch.sequenceOrder !== undefined) payload.sequence_order = patch.sequenceOrder;
  if (patch.isActive !== undefined) payload.is_active = patch.isActive;

  // Overnight audit (2026-09-11, task 2): this PATCH was completely
  // unchecked. Safe to verify here -- the caller (handleUpdateSiteHardwareRule)
  // was wrapped in a try/catch matching its sibling "add" handler's existing
  // status-message pattern in the same pass. Deliberately does NOT revert
  // the caller's optimistic local update on failure (that pattern caused a
  // real concurrency bug elsewhere in this codebase) -- the status message
  // alone is the safe, visible signal.
  const response = await fetch(supabaseUrl(`site_hardware_rules?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateSiteHardwareRule failed for rule ${id} (${response.status}): ${bodyText}`);
    throw new Error("Could not save this change.");
  }
  const rows = (await response.json().catch(() => [])) as unknown[];
  if (rows.length === 0) {
    console.error(`updateSiteHardwareRule affected 0 rows for rule ${id} -- likely blocked by RLS or a missing rule.`);
    throw new Error("Could not save this change.");
  }
}

export async function deleteSiteHardwareRule(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`site_hardware_rules?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete rule") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("site_hardware_rule", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

// --- Phase 21: Task-Linked Inventory Automation ----------------------------

export type TaskHardwareDependency = {
  id: string;
  taskId: string;
  projectBomLineId: string | null;
  inventoryItemId: string | null;
  quantityRequired: number;
  fulfillmentStatus: "pending" | "allocated" | "procurement_queued";
};

type TaskHardwareDependencyRow = {
  id: string;
  task_id: string;
  project_bom_line_id: string | null;
  inventory_item_id: string | null;
  quantity_required: number | string;
  fulfillment_status: TaskHardwareDependency["fulfillmentStatus"];
};

function mapTaskDependencyRow(row: TaskHardwareDependencyRow): TaskHardwareDependency {
  return {
    id: row.id,
    taskId: row.task_id,
    projectBomLineId: row.project_bom_line_id,
    inventoryItemId: row.inventory_item_id,
    quantityRequired: Number(row.quantity_required),
    fulfillmentStatus: row.fulfillment_status,
  };
}

export async function loadTaskHardwareDependencies(accessToken?: string): Promise<TaskHardwareDependency[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetchWithDeletedAtFallback(supabaseUrl("task_hardware_dependencies?select=*&deleted_at=is.null"), supabaseHeaders(accessToken));
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as TaskHardwareDependencyRow[];
  return rows.map(mapTaskDependencyRow);
}

export async function addTaskHardwareDependency(
  dependency: Omit<TaskHardwareDependency, "id" | "fulfillmentStatus">,
  accessToken?: string,
): Promise<TaskHardwareDependency> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }
  const response = await fetch(supabaseUrl("task_hardware_dependencies"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      task_id: dependency.taskId,
      project_bom_line_id: dependency.projectBomLineId,
      inventory_item_id: dependency.inventoryItemId,
      quantity_required: dependency.quantityRequired,
    }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`addTaskHardwareDependency: insert failed for task ${dependency.taskId} (${response.status}): ${bodyText}`);
    throw new Error(`Could not link hardware to task: ${response.status}`);
  }
  const rows = (await response.json()) as TaskHardwareDependencyRow[];
  if (!rows[0]) {
    console.error(`addTaskHardwareDependency: insert for task ${dependency.taskId} returned no row.`);
    throw new Error("Could not link hardware to task.");
  }
  return mapTaskDependencyRow(rows[0]);
}

// Reviewed 2026-09-12 (overnight reliability closeout, task 5): this PATCH
// used to be completely unchecked -- the response was awaited and
// discarded, so a failure (RLS, network, expired session) looked
// identical to a success. Its one caller, runTaskHardwareAutomation
// (main.tsx), is fire-and-forget and not awaited with no .catch, so this
// stays non-throwing by design (a mechanical throw here would surface as
// an unhandled promise rejection, a worse failure mode than today's
// silent no-op) -- this only makes a real failure visible in the console
// for diagnosis. The caller's own unconditional local-state update on a
// failed PATCH (a real client/server desync risk) is unchanged --
// documented as a known follow-up, not fixed here (fixing it would mean
// changing the automation's fire-and-forget shape, which is a workflow
// decision, not an isolated .ok-check addition).
export async function updateTaskHardwareDependencyStatus(
  id: string,
  fulfillmentStatus: TaskHardwareDependency["fulfillmentStatus"],
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const response = await fetch(supabaseUrl(`task_hardware_dependencies?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ fulfillment_status: fulfillmentStatus }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateTaskHardwareDependencyStatus: PATCH failed for dependency ${id} (${response.status}): ${bodyText}`);
  }
}

// Natural-key bridges (same pattern as resolveProjectId) so the Linked
// Hardware picker and the automation that reads dependencies back can both
// work off `inventory_items.sku`, which is what the app's `Part.ref` field
// (loaded via loadInventoryItems, Phase 10c) keys on.

export async function resolveInventoryItemIdBySku(sku: string, accessToken?: string): Promise<string | null> {
  if (!isRemotePersistenceConfigured() || !accessToken || !sku) {
    return null;
  }
  const response = await fetch(supabaseUrl(`inventory_items?sku=eq.${encodeURIComponent(sku)}&select=id&limit=1`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

export async function loadInventoryItemSkusByIds(ids: string[], accessToken?: string): Promise<Record<string, string>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!isRemotePersistenceConfigured() || !accessToken || uniqueIds.length === 0) {
    return {};
  }
  const response = await fetch(supabaseUrl(`inventory_items?id=in.(${uniqueIds.join(",")})&select=id,sku`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return {};
  }
  const rows = (await response.json()) as Array<{ id: string; sku: string }>;
  return Object.fromEntries(rows.map((row) => [row.id, row.sku]));
}

export async function deleteTaskHardwareDependency(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`task_hardware_dependencies?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete dependency") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("task_hardware_dependency", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

// --- Phase 10b: Project Documents cutover ----------------------------------
// First Phase 10 entity actually cut over from the app_records blob to its
// real table. The Postgres `id` (uuid) is now the canonical document id --
// creation is a real round trip (insert, then use the returned row) instead
// of the old client-generated `makeId("doc")` + optimistic local update.

export type ProjectDocument = {
  id: string;
  name: string;
  project: string;
  size: number;
  status: "Uploaded" | "Ready to review" | "Backed up" | "Archived";
  type?:
    | "Procurement"
    | "Sales Quote"
    | "SOW"
    | "BOM"
    | "Project"
    // Migration 096 -- E: "a separate section for Drawings or within
    // project documents a sub folder for drawings" -- working drawings,
    // distinct from Closeout's single final As-Built Diagram below.
    | "Drawings"
    // Migration 089 (Client Ledger's Closeout Vault) -- final, handoff-time
    // documents, distinct from the working documents above.
    | "As-Built Diagram"
    | "O&M Manual"
    | "Completion Certificate"
    | "Network/IP Schema"
    | "Power/Breaker Schedule";
  storage?: "Browser" | "Google Drive" | "Supabase Storage";
  uploadedAt?: string;
  uploadedByEmail?: string;
  // Path inside the private "project-documents" Storage bucket -- present
  // once the real file bytes were actually uploaded (Phase: real file
  // storage). Resolve it to a usable link with getDocumentDownloadUrl.
  storagePath?: string;
  // Real link to the exact Purchase Order / Purchase Request this document
  // belongs to (migration 080) -- not just the project it's filed under.
  // Most documents (general project files) link to neither.
  purchaseOrderId?: string;
  purchaseRequestId?: string;
  // The document's real, already-assigned project_documents.document_number
  // (added 2026-09-12, overnight reliability closeout task 3) -- previously
  // write-only from the client's perspective (generated fresh from
  // Date.now() on every create/restore, never read back), which is exactly
  // why a restore retry of the same snapshot used to produce a different
  // document_number each time. Present for any document that has already
  // been saved once; undefined only for a document that has never round-
  // tripped through a load (there is no other case on the restore path,
  // since a snapshot's documents always come from loadFullBackupSnapshot ->
  // loadProjectDocuments, i.e. real, already-numbered rows).
  documentNumber?: string;
};

type ProjectDocumentRow = {
  id: string;
  document_number?: string | null;
  project_name: string | null;
  file_name: string;
  file_size_bytes: number | string;
  status: string;
  document_type: string;
  storage_status: string;
  uploaded_at: string | null;
  uploaded_by_email: string | null;
  file_url: string | null;
  purchase_order_id?: string | null;
  purchase_request_id?: string | null;
};

function appDocumentType(type: ProjectDocument["type"]): string {
  switch (type) {
    // Stored value stays "purchasing" (matches the existing DB rows and the
    // internal view/role keys elsewhere in the app) even though the
    // user-facing label is now "Procurement" -- only the display text changed.
    case "Procurement": return "purchasing";
    case "Sales Quote": return "sales_quote";
    case "SOW": return "sow";
    case "BOM": return "bom";
    case "Project": return "project";
    case "Drawings": return "drawings";
    case "As-Built Diagram": return "as_built";
    case "O&M Manual": return "om_manual";
    case "Completion Certificate": return "completion_certificate";
    case "Network/IP Schema": return "network_schema";
    case "Power/Breaker Schedule": return "power_schedule";
    default: return "other";
  }
}

function pgDocumentType(documentType: string): ProjectDocument["type"] {
  switch (documentType) {
    case "purchasing": return "Procurement";
    case "sales_quote": return "Sales Quote";
    case "sow": return "SOW";
    case "bom": return "BOM";
    case "project": return "Project";
    case "drawings": return "Drawings";
    case "as_built": return "As-Built Diagram";
    case "om_manual": return "O&M Manual";
    case "completion_certificate": return "Completion Certificate";
    case "network_schema": return "Network/IP Schema";
    case "power_schedule": return "Power/Breaker Schedule";
    default: return undefined;
  }
}

function appDocumentStatus(status: string): ProjectDocument["status"] {
  switch (status) {
    case "ready_to_review": case "extracting": return "Ready to review";
    case "backed_up": case "approved": return "Backed up";
    case "archived": case "rejected": return "Archived";
    default: return "Uploaded";
  }
}

function pgDocumentStatus(status: ProjectDocument["status"]): string {
  switch (status) {
    case "Ready to review": return "ready_to_review";
    case "Backed up": return "backed_up";
    case "Archived": return "archived";
    default: return "uploaded";
  }
}

function appDocumentStorage(storageStatus: string): ProjectDocument["storage"] {
  switch (storageStatus) {
    case "google_drive": return "Google Drive";
    case "supabase_storage": return "Supabase Storage";
    default: return "Browser";
  }
}

function pgDocumentStorage(storage: ProjectDocument["storage"]): string {
  switch (storage) {
    case "Google Drive": return "google_drive";
    case "Supabase Storage": return "supabase_storage";
    default: return "browser";
  }
}

function mapProjectDocumentRow(row: ProjectDocumentRow): ProjectDocument {
  return {
    id: row.id,
    documentNumber: row.document_number ?? undefined,
    name: row.file_name,
    project: row.project_name ?? "",
    size: Number(row.file_size_bytes),
    status: appDocumentStatus(row.status),
    type: pgDocumentType(row.document_type),
    storage: appDocumentStorage(row.storage_status),
    uploadedAt: row.uploaded_at ?? undefined,
    uploadedByEmail: row.uploaded_by_email ?? undefined,
    storagePath: row.file_url ?? undefined,
    purchaseOrderId: row.purchase_order_id ?? undefined,
    purchaseRequestId: row.purchase_request_id ?? undefined,
  };
}

export async function loadProjectDocuments(accessToken?: string): Promise<ProjectDocument[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl("project_documents?select=id,document_number,project_name,file_name,file_size_bytes,status,document_type,storage_status,uploaded_at,uploaded_by_email,file_url,purchase_order_id,purchase_request_id&order=uploaded_at.desc"), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok && response.status === 400) {
    // Self-healing fallback for migration 068 not being applied yet
    // (uploaded_by_email/purchase_order_id/purchase_request_id missing)
    // -- deliberately kept, this degrades gracefully rather than
    // failing outright. But if the FALLBACK itself also fails, that's
    // a real error (permissions, outage, a different missing column),
    // not "no documents" -- throw instead of masking it as empty.
    const fallbackResponse = await fetch(supabaseUrl("project_documents?select=id,document_number,project_name,file_name,file_size_bytes,status,document_type,storage_status,uploaded_at,file_url&order=uploaded_at.desc"), {
      headers: supabaseHeaders(accessToken),
    });
    if (!fallbackResponse.ok) {
      throw new Error(await readSupabaseError(fallbackResponse, "Could not load project documents"));
    }
    const fallbackRows = (await fallbackResponse.json()) as Array<Omit<ProjectDocumentRow, "uploaded_by_email" | "purchase_order_id" | "purchase_request_id">>;
    return fallbackRows.map((row) => mapProjectDocumentRow({ ...row, uploaded_by_email: null, purchase_order_id: null, purchase_request_id: null }));
  }
  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Could not load project documents"));
  }
  const rows = (await response.json()) as ProjectDocumentRow[];
  return rows.map(mapProjectDocumentRow);
}

export async function createProjectDocuments(
  docs: Array<Omit<ProjectDocument, "id">>,
  accessToken?: string,
): Promise<ProjectDocument[]> {
  if (!isRemotePersistenceConfigured() || !accessToken || docs.length === 0) {
    return [];
  }
  const payload = docs.map((doc, index) => ({
    document_number: `DOC-${Date.now().toString(36).toUpperCase()}-${index}`,
    project_name: doc.project || null,
    document_type: appDocumentType(doc.type),
    file_name: doc.name,
    file_size_bytes: doc.size,
    status: pgDocumentStatus(doc.status),
    storage_status: pgDocumentStorage(doc.storage),
    storage_provider: doc.storage === "Supabase Storage" ? "supabase_storage" : "browser",
    file_url: doc.storagePath ?? null,
    uploaded_at: doc.uploadedAt ?? new Date().toISOString(),
    uploaded_by_email: doc.uploadedByEmail ?? null,
    purchase_order_id: doc.purchaseOrderId ?? null,
    purchase_request_id: doc.purchaseRequestId ?? null,
  }));
  const response = await fetch(supabaseUrl("project_documents"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    if (response.status === 400) {
      const fallbackPayload = payload.map(({ uploaded_by_email: _uploadedByEmail, purchase_order_id: _purchaseOrderId, purchase_request_id: _purchaseRequestId, ...doc }) => doc);
      const fallbackResponse = await fetch(supabaseUrl("project_documents"), {
        method: "POST",
        headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
        body: JSON.stringify(fallbackPayload),
      });
      if (fallbackResponse.ok) {
        const fallbackRows = (await fallbackResponse.json()) as Array<Omit<ProjectDocumentRow, "uploaded_by_email" | "purchase_order_id" | "purchase_request_id">>;
        return fallbackRows.map((row) => mapProjectDocumentRow({ ...row, uploaded_by_email: null, purchase_order_id: null, purchase_request_id: null }));
      }
    }
    throw new Error(`Could not save document(s): ${response.status}`);
  }
  const rows = (await response.json()) as ProjectDocumentRow[];
  return rows.map(mapProjectDocumentRow);
}

export async function updateProjectDocumentStatusRemote(
  id: string,
  status: ProjectDocument["status"],
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const response = await fetch(supabaseUrl(`project_documents?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ status: pgDocumentStatus(status) }),
  });
  if (!response.ok) {
    throw new Error(`Could not update document status: ${response.status}`);
  }
  // A permissions-blocked PATCH still returns 200/204 with zero rows changed.
  const rows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error("That status change didn't affect anything -- you may not have permission.");
  }
}

// Real Storage: "Uploaded" used to only mean "we recorded the name and
// size" -- the file itself was never sent anywhere, so it was gone the
// moment the tab closed. This actually puts the bytes in a private
// Supabase Storage bucket (see migration 031) and returns a storage path to
// save alongside the document row (project_documents.file_url).
const DOCUMENT_STORAGE_BUCKET = "project-documents";

function sanitizeStoragePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 120) || "file";
}

export function buildDocumentStoragePath(projectName: string, fileName: string): string {
  const stamp = Date.now().toString(36);
  return `${sanitizeStoragePathSegment(projectName || "unassigned")}/${stamp}-${sanitizeStoragePathSegment(fileName)}`;
}

export async function uploadDocumentFile(file: File, storagePath: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
  const response = await fetch(
    `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/${DOCUMENT_STORAGE_BUCKET}/${storagePath}`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": file.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: file,
    },
  );
  return response.ok;
}

export async function getDocumentDownloadUrl(storagePath: string, accessToken?: string): Promise<string | null> {
  if (!isRemotePersistenceConfigured() || !accessToken || !storagePath) {
    return null;
  }
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
  const response = await fetch(
    `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/sign/${DOCUMENT_STORAGE_BUCKET}/${storagePath}`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    },
  );
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { signedURL?: string };
  if (!body.signedURL) {
    return null;
  }
  return `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1${body.signedURL}`;
}

// --- Phase 10a: Purchase Requests (cut over from the app_records blob to the
// relational `purchase_requests` table, migration 016) -----------------------

export type PurchaseRequest = {
  id: string;
  requestNumber: string;
  sku: string;
  itemName: string;
  quantity: number;
  reason: "Reorder Point" | "Planned Build Shortage" | "Manual" | "Project BOM";
  sourceRef?: string;
  projectName?: string;
  procurementTrack?: "warehouse_stock" | "direct_to_project";
  preferredVendor?: string;
  poNumber?: string;
  expectedDate?: string;
  estimatedUnitCost: number;
  receivedQuantity?: number;
  status: "Draft" | "Need Quote" | "Ready to Order" | "Ordered" | "Received" | "Cancelled";
  createdAt: string;
  notes: string;
  requestedByEmail?: string;
  // Real link to the Purchase Order this request became, once someone
  // clicks "Create Purchase" on it (migration 081) -- the request record
  // itself is never deleted or replaced, this just points at what it
  // turned into. Undefined until that happens.
  linkedPurchaseOrderId?: string;
};

type PurchaseRequestRow = {
  id: string;
  request_number: string;
  sku_snapshot: string | null;
  item_name_snapshot: string | null;
  quantity_requested: number | string;
  reason: string;
  source_ref: string | null;
  project_name: string | null;
  procurement_track: string | null;
  preferred_vendor: string | null;
  po_number: string | null;
  expected_date: string | null;
  estimated_unit_cost: number | string;
  quantity_received: number | string | null;
  status: string;
  created_at: string;
  notes: string | null;
  requested_by_email: string | null;
  linked_purchase_order_id: string | null;
};

function appPurchaseReason(reason: string): PurchaseRequest["reason"] {
  switch (reason) {
    case "reorder_point": return "Reorder Point";
    case "planned_build_shortage": return "Planned Build Shortage";
    case "project_bom": return "Project BOM";
    default: return "Manual";
  }
}

function pgPurchaseReason(reason: PurchaseRequest["reason"]): string {
  switch (reason) {
    case "Reorder Point": return "reorder_point";
    case "Planned Build Shortage": return "planned_build_shortage";
    case "Project BOM": return "project_bom";
    default: return "manual";
  }
}

function pgPurchaseSourceType(reason: PurchaseRequest["reason"]): string {
  switch (reason) {
    case "Project BOM": return "project";
    case "Planned Build Shortage": return "build";
    case "Reorder Point": return "inventory";
    default: return "manual";
  }
}

function appPurchaseStatus(status: string): PurchaseRequest["status"] {
  switch (status) {
    case "need_quote": return "Need Quote";
    case "ready_to_order": return "Ready to Order";
    case "ordered": return "Ordered";
    case "received": return "Received";
    case "cancelled": return "Cancelled";
    default: return "Draft";
  }
}

function pgPurchaseStatus(status: PurchaseRequest["status"]): string {
  switch (status) {
    case "Need Quote": return "need_quote";
    case "Ready to Order": return "ready_to_order";
    case "Ordered": return "ordered";
    case "Received": return "received";
    case "Cancelled": return "cancelled";
    default: return "draft";
  }
}

function mapPurchaseRequestRow(row: PurchaseRequestRow): PurchaseRequest {
  return {
    id: row.id,
    requestNumber: row.request_number,
    sku: row.sku_snapshot ?? "",
    itemName: row.item_name_snapshot ?? "",
    quantity: Number(row.quantity_requested) || 0,
    reason: appPurchaseReason(row.reason),
    sourceRef: row.source_ref ?? undefined,
    projectName: row.project_name ?? undefined,
    procurementTrack: (row.procurement_track === "direct_to_project" ? "direct_to_project" : "warehouse_stock"),
    preferredVendor: row.preferred_vendor ?? undefined,
    poNumber: row.po_number ?? undefined,
    expectedDate: row.expected_date ?? undefined,
    estimatedUnitCost: Number(row.estimated_unit_cost) || 0,
    receivedQuantity: Number(row.quantity_received) || 0,
    status: appPurchaseStatus(row.status),
    createdAt: row.created_at,
    notes: row.notes ?? "",
    requestedByEmail: row.requested_by_email ?? undefined,
    linkedPurchaseOrderId: row.linked_purchase_order_id ?? undefined,
  };
}

const PURCHASE_REQUEST_SELECT =
  "id,request_number,sku_snapshot,item_name_snapshot,quantity_requested,reason,source_ref,project_name,procurement_track,preferred_vendor,po_number,expected_date,estimated_unit_cost,quantity_received,status,created_at,notes,requested_by_email,linked_purchase_order_id";

const PURCHASE_REQUEST_SELECT_LEGACY =
  "id,request_number,sku_snapshot,item_name_snapshot,quantity_requested,reason,source_ref,project_name,procurement_track,preferred_vendor,po_number,expected_date,estimated_unit_cost,quantity_received,status,created_at,notes,requested_by_email";

export async function loadPurchaseRequests(accessToken?: string): Promise<PurchaseRequest[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl(`purchase_requests?select=${PURCHASE_REQUEST_SELECT}&order=created_at.desc`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok && response.status === 400) {
    const fallbackResponse = await fetch(supabaseUrl(`purchase_requests?select=${PURCHASE_REQUEST_SELECT_LEGACY}&order=created_at.desc`), {
      headers: supabaseHeaders(accessToken),
    });
    if (!fallbackResponse.ok) {
      return [];
    }
    const fallbackRows = (await fallbackResponse.json()) as Array<Omit<PurchaseRequestRow, "linked_purchase_order_id">>;
    return fallbackRows.map((row) => mapPurchaseRequestRow({ ...row, linked_purchase_order_id: null }));
  }
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as PurchaseRequestRow[];
  return rows.map(mapPurchaseRequestRow);
}

export async function createPurchaseRequestRemote(
  input: {
    requestNumber: string;
    sku: string;
    itemName: string;
    quantity: number;
    reason: PurchaseRequest["reason"];
    sourceRef?: string;
    projectName?: string;
    procurementTrack?: PurchaseRequest["procurementTrack"];
    preferredVendor?: string;
    estimatedUnitCost: number;
    status: PurchaseRequest["status"];
    notes: string;
    requestedByEmail?: string;
  },
  accessToken?: string,
): Promise<PurchaseRequest | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const payload = {
    request_number: input.requestNumber,
    sku_snapshot: input.sku,
    item_name_snapshot: input.itemName,
    quantity_requested: input.quantity,
    reason: pgPurchaseReason(input.reason),
    source_type: pgPurchaseSourceType(input.reason),
    source_ref: input.sourceRef ?? null,
    project_name: input.projectName ?? null,
    procurement_track: input.procurementTrack ?? "warehouse_stock",
    preferred_vendor: input.preferredVendor ?? null,
    estimated_unit_cost: input.estimatedUnitCost,
    status: pgPurchaseStatus(input.status),
    notes: input.notes,
    requested_by_email: input.requestedByEmail ?? null,
  };
  const response = await fetch(supabaseUrl("purchase_requests"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`createPurchaseRequestRemote: insert failed (${response.status}): ${bodyText}`);
    throw new Error(`Could not save purchase request: ${response.status}`);
  }
  const rows = (await response.json()) as PurchaseRequestRow[];
  return rows[0] ? mapPurchaseRequestRow(rows[0]) : null;
}

export async function updatePurchaseRequestRemote(
  id: string,
  updates: Partial<{
    quantity: number;
    preferredVendor: string;
    poNumber: string | null;
    expectedDate: string | null;
    estimatedUnitCost: number;
    status: PurchaseRequest["status"];
    notes: string;
    procurementTrack: PurchaseRequest["procurementTrack"];
    projectName: string | null;
    receivedQuantity: number;
    linkedPurchaseOrderId: string | null;
  }>,
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (updates.quantity !== undefined) payload.quantity_requested = updates.quantity;
  if (updates.preferredVendor !== undefined) payload.preferred_vendor = updates.preferredVendor;
  if (updates.poNumber !== undefined) payload.po_number = updates.poNumber || null;
  if (updates.expectedDate !== undefined) payload.expected_date = updates.expectedDate || null;
  if (updates.estimatedUnitCost !== undefined) payload.estimated_unit_cost = updates.estimatedUnitCost;
  if (updates.status !== undefined) payload.status = pgPurchaseStatus(updates.status);
  if (updates.notes !== undefined) payload.notes = updates.notes;
  if (updates.procurementTrack !== undefined) payload.procurement_track = updates.procurementTrack;
  if (updates.projectName !== undefined) payload.project_name = updates.projectName || null;
  if (updates.receivedQuantity !== undefined) payload.quantity_received = updates.receivedQuantity;
  if (updates.linkedPurchaseOrderId !== undefined) payload.linked_purchase_order_id = updates.linkedPurchaseOrderId;
  if (Object.keys(payload).length === 0) {
    return;
  }
  let response = await fetch(supabaseUrl(`purchase_requests?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!response.ok && response.status === 400 && "linked_purchase_order_id" in payload) {
    const { linked_purchase_order_id: _linkedPurchaseOrderId, ...fallbackPayload } = payload;
    response = await fetch(supabaseUrl(`purchase_requests?id=eq.${id}`), {
      method: "PATCH",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify(fallbackPayload),
    });
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updatePurchaseRequestRemote: PATCH failed for request ${id} (${response.status}): ${bodyText}`);
    throw new Error(`Could not update purchase request: ${response.status}`);
  }
  // A permissions-blocked PATCH still returns 200/204 with zero rows changed.
  const rows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (rows.length === 0) {
    console.error(`updatePurchaseRequestRemote: PATCH for request ${id} affected 0 rows -- likely blocked by RLS.`);
    throw new Error("That change didn't affect anything -- you may not have permission.");
  }
}

// --- Phase 10c: Inventory Items + Price History (cut over from the
// app_records blob to the relational `inventory_items` table, migration 018)
// -----------------------------------------------------------------------
//
// This entity keeps the exact same whole-array "load once, debounce-save the
// full array" shape the blob used, rather than converting every stock
// mutation call site (pull/receive/transfer/build-consume/build-undo/adjust)
// into its own network call -- those all stay as in-memory React state
// updates in main.tsx, completely unchanged. Only the persistence backing
// moves from the JSON blob to inventory_items + inventory_balances.

export type PurchaseUrl = { id: number; label: string; url: string };
export type PriceHistoryEntry = { id: number; date: string; vendor: string; unitCost: number; notes: string };

export type Part = {
  ref: string;
  name: string;
  description: string;
  manufacturer: string;
  category: "Base" | "Communications" | "Power" | "Lighting" | "Display" | "Build";
  cost: number;
  stock: number;
  // Migration 091: earmarked for a project via BOM/task auto-allocation,
  // still physically on hand (not yet shipped) -- see allocateFromInventory.
  // `stock` above stays "physically in the building" regardless of this;
  // "available to promise" is stock - allocated, computed where needed,
  // not stored. Optional (not undefined once loaded -- mapInventoryItemRow
  // always sets a real number) only so the many hardcoded/demo Part
  // literals sprinkled around main.tsx that predate the real backend
  // cutover don't all need updating; read as `part.allocated ?? 0`.
  allocated?: number;
  reorderPoint: number;
  // Migration 092: explicit "track reorder for this item" switch, replacing
  // the earlier "reorder point 0 = disabled" overload -- 0 can now be a
  // real threshold again when this is true. Optional for the same
  // hardcoded-seed-literal reason as `allocated` above; read as
  // `part.trackReorder ?? false`. Defaults to false (most items are
  // one-offs, per E).
  trackReorder?: boolean;
  vendorUrl?: string;
  imageUrl?: string;
  barcode?: string;
  purchaseUrls?: PurchaseUrl[];
  priceHistory?: PriceHistoryEntry[];
  tags?: string[];
  retired?: boolean;
};

type InventoryItemRow = {
  id: string;
  sku: string;
  item_name: string;
  description: string | null;
  manufacturer: string | null;
  category: string | null;
  default_unit_cost: number | string;
  reorder_point: number | string;
  vendor_url: string | null;
  image_url: string | null;
  barcode_value: string | null;
  purchase_sources: PurchaseUrl[] | null;
  price_history: PriceHistoryEntry[] | null;
  inventory_tags: string[] | null;
  is_active: boolean;
  inventory_balances: Array<{ quantity_on_hand: number | string; quantity_allocated: number | string | null }> | null;
  track_reorder: boolean | null;
};

const INVENTORY_ITEM_SELECT =
  "id,sku,item_name,description,manufacturer,category,default_unit_cost,reorder_point,track_reorder,vendor_url,image_url,barcode_value,purchase_sources,price_history,inventory_tags,is_active,inventory_balances(quantity_on_hand,quantity_allocated)";
// Migration 092 safety: same shape minus track_reorder, in case that
// column hasn't landed yet -- without this, the whole Inventory load 400s.
const INVENTORY_ITEM_SELECT_PRE_092 =
  "id,sku,item_name,description,manufacturer,category,default_unit_cost,reorder_point,vendor_url,image_url,barcode_value,purchase_sources,price_history,inventory_tags,is_active,inventory_balances(quantity_on_hand,quantity_allocated)";
// Migration 091 safety: same shape minus quantity_allocated either, in
// case that column hasn't landed yet.
const INVENTORY_ITEM_SELECT_PRE_091 =
  "id,sku,item_name,description,manufacturer,category,default_unit_cost,reorder_point,vendor_url,image_url,barcode_value,purchase_sources,price_history,inventory_tags,is_active,inventory_balances(quantity_on_hand)";

function mapInventoryItemRow(row: InventoryItemRow): Part {
  const stock = (row.inventory_balances ?? []).reduce((sum, balance) => sum + (Number(balance.quantity_on_hand) || 0), 0);
  const allocated = (row.inventory_balances ?? []).reduce((sum, balance) => sum + (Number(balance.quantity_allocated) || 0), 0);
  return {
    ref: row.sku,
    name: row.item_name,
    description: row.description ?? "",
    manufacturer: row.manufacturer ?? "",
    category: (row.category as Part["category"]) ?? "Base",
    cost: Number(row.default_unit_cost) || 0,
    stock,
    allocated,
    reorderPoint: Number(row.reorder_point) || 0,
    trackReorder: Boolean(row.track_reorder),
    vendorUrl: row.vendor_url ?? undefined,
    imageUrl: row.image_url ?? undefined,
    barcode: row.barcode_value ?? undefined,
    purchaseUrls: row.purchase_sources ?? [],
    priceHistory: row.price_history ?? [],
    tags: row.inventory_tags ?? [],
    retired: !row.is_active,
  };
}

export async function loadInventoryItems(accessToken?: string): Promise<Part[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl(`inventory_items?select=${INVENTORY_ITEM_SELECT}&order=item_name.asc`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok && response.status === 400) {
    const fallbackResponse = await fetch(supabaseUrl(`inventory_items?select=${INVENTORY_ITEM_SELECT_PRE_092}&order=item_name.asc`), {
      headers: supabaseHeaders(accessToken),
    });
    if (fallbackResponse.ok) {
      const fallbackRows = (await fallbackResponse.json()) as InventoryItemRow[];
      return fallbackRows.map(mapInventoryItemRow);
    }
    if (fallbackResponse.status !== 400) {
      return [];
    }
    const olderFallbackResponse = await fetch(supabaseUrl(`inventory_items?select=${INVENTORY_ITEM_SELECT_PRE_091}&order=item_name.asc`), {
      headers: supabaseHeaders(accessToken),
    });
    if (!olderFallbackResponse.ok) {
      return [];
    }
    const olderFallbackRows = (await olderFallbackResponse.json()) as InventoryItemRow[];
    return olderFallbackRows.map(mapInventoryItemRow);
  }
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as InventoryItemRow[];
  return rows.map(mapInventoryItemRow);
}

let mainWarehouseLocationId: string | null = null;

async function getMainWarehouseLocationId(accessToken: string): Promise<string | null> {
  if (mainWarehouseLocationId) {
    return mainWarehouseLocationId;
  }
  const response = await fetch(supabaseUrl("locations?select=id&name=eq.Main Warehouse&limit=1"), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as Array<{ id: string }>;
  mainWarehouseLocationId = rows[0]?.id ?? null;
  return mainWarehouseLocationId;
}

// Inventory items only ever had Retire (is_active) as a "make it go away"
// path -- E asked to actually delete a merge-testing item outright ("we
// will eventually start with fresh data"). Real hard delete, matching
// deleteEquipmentType's shape: several tables reference inventory_items.id
// with no ON DELETE clause (inventory_balances, inventory_movements,
// purchase_order_lines, equipment_bom_components, and more), so an item
// with any real stock/movement/BOM history will legitimately fail with a
// 409 -- Retire is the correct action for those, not a bug to work around.
export async function deleteInventoryItem(sku: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const lookupResponse = await fetch(supabaseUrl(`inventory_items?sku=eq.${encodeURIComponent(sku)}&select=id,item_name`), {
    headers: supabaseHeaders(accessToken),
  });
  const lookupRows = lookupResponse.ok ? ((await lookupResponse.json()) as Array<{ id: string; item_name: string }>) : [];
  const item = lookupRows[0];
  if (!item) {
    // Nothing remote to delete -- either never synced yet or already gone.
    return { ok: true };
  }
  const response = await fetch(supabaseUrl(`inventory_items?id=eq.${item.id}`), {
    method: "DELETE",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
  });
  if (!response.ok) {
    if (response.status === 409) {
      return { ok: false, error: "Can't delete -- this item has stock, movement, or build-BOM history. Use Retire instead to keep it out of the picker without losing that history." };
    }
    return { ok: false, error: await readSupabaseError(response, "Could not delete inventory item") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't remove anything -- you may not have permission." };
  }
  await logDeletionEvent("inventory_item", item.id, item.item_name || sku, "deleted", actorEmail, accessToken);
  return { ok: true };
}

// E: "i think ADMIN should be able to delete it because I will have a lot
// of demo data i will have to delete eventually." The normal delete above
// blocks on ANY inventory_balances row existing at all -- but every item
// gets one automatically at creation (it's how quantity_on_hand is
// tracked, even at 0), so in practice the normal delete blocks nearly
// every item, demo or not, not just ones with real history.
//
// This is deliberately narrower than "admin can delete anything": it only
// clears inventory_balances rows that are genuinely empty
// (quantity_on_hand = 0, quantity_reserved = 0) before retrying, so a
// brand-new/never-touched demo item can actually be removed. If real
// movements, BOM membership, or purchase order lines exist, the delete
// still fails -- even for an admin, on purpose -- since that's real
// business/audit history, not demo clutter, and destroying it would be a
// much bigger decision than "let admin clean up test data."
export async function forceDeleteInventoryItem(sku: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const lookupResponse = await fetch(supabaseUrl(`inventory_items?sku=eq.${encodeURIComponent(sku)}&select=id,item_name`), {
    headers: supabaseHeaders(accessToken),
  });
  const lookupRows = lookupResponse.ok ? ((await lookupResponse.json()) as Array<{ id: string; item_name: string }>) : [];
  const item = lookupRows[0];
  if (!item) {
    return { ok: true };
  }
  await fetch(supabaseUrl(`inventory_balances?inventory_item_id=eq.${item.id}&quantity_on_hand=eq.0&quantity_reserved=eq.0`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });
  const response = await fetch(supabaseUrl(`inventory_items?id=eq.${item.id}`), {
    method: "DELETE",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
  });
  if (!response.ok) {
    if (response.status === 409) {
      return { ok: false, error: "Still can't delete -- this item has real movement, build-BOM, or purchase order history, not just an empty stock record. Use Retire instead." };
    }
    return { ok: false, error: await readSupabaseError(response, "Could not delete inventory item") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't remove anything -- you may not have permission." };
  }
  await logDeletionEvent("inventory_item", item.id, `${item.item_name || sku} (admin force-delete)`, "deleted", actorEmail, accessToken);
  return { ok: true };
}

export async function saveInventoryItems(items: Part[], accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken || items.length === 0) {
    return;
  }
  const itemPayload = items.map((item) => ({
    sku: item.ref,
    item_name: item.name,
    description: item.description || null,
    manufacturer: item.manufacturer || null,
    category: item.category,
    default_unit_cost: item.cost,
    reorder_point: item.reorderPoint,
    track_reorder: item.trackReorder ?? false,
    vendor_url: item.vendorUrl || null,
    image_url: item.imageUrl || null,
    barcode_value: item.barcode || null,
    purchase_sources: item.purchaseUrls ?? [],
    price_history: item.priceHistory ?? [],
    inventory_tags: item.tags ?? [],
    is_active: !item.retired,
  }));

  let itemResponse = await fetch(supabaseUrl("inventory_items?on_conflict=sku"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(itemPayload),
  });
  // Migration 092 safety: retry without track_reorder if it hasn't landed
  // yet, so the rest of the item still saves.
  if (!itemResponse.ok && itemResponse.status === 400) {
    const fallbackItemPayload = itemPayload.map(({ track_reorder: _trackReorder, ...rest }) => rest);
    itemResponse = await fetch(supabaseUrl("inventory_items?on_conflict=sku"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(fallbackItemPayload),
    });
  }
  if (!itemResponse.ok) {
    const bodyText = await itemResponse.text().catch(() => "");
    console.error(`saveInventoryItems: inventory_items write failed (${itemResponse.status}): ${bodyText}`);
    throw new Error("Some inventory item details could not be saved.");
  }
  const savedRows = (await itemResponse.json()) as Array<{ id: string; sku: string }>;
  // A row count that doesn't exactly match what was sent is an
  // unexpected response cardinality -- an integrity anomaly worth
  // rejecting defensively, not a demonstrated RLS/constraint mechanism.
  // Corrected 2026-09-11 (review): a single multi-row INSERT ... ON
  // CONFLICT is one atomic statement -- an ordinary RLS WITH CHECK
  // rejection or constraint violation on any row fails the WHOLE
  // statement (already caught by the !itemResponse.ok check above), it
  // does not silently drop or duplicate just the offending row while the
  // rest succeed. No specific trigger or policy in this schema is known
  // to behave that way. This check remains as defensive verification --
  // every field on every item rides on this one upsert (tags, cost,
  // category, everything), so it's still worth confirming the count
  // matches exactly, the same posture already applied to the balance
  // write below -- but a mismatch here would be a genuine surprise to
  // investigate, not the expected shape of a known failure mode.
  //
  // Exact equality (`!==`, not just `<`) is safe here, reviewed 2026-09-11:
  // this is a single-table `on_conflict=sku` upsert, and Postgres itself
  // hard-errors ("ON CONFLICT DO UPDATE command cannot affect row a second
  // time") if the payload ever contains a duplicate sku -- that failure
  // surfaces as a non-OK response above, not as a silent over-count
  // success. There is no legitimate path for this specific upsert to
  // return more rows than were sent, so treating an over-count as a
  // failure (matching the balance/scope-of-work writes fixed the same way
  // in this function and saveProjectSites) cannot produce a false
  // failure.
  if (savedRows.length !== itemPayload.length) {
    console.error(
      `saveInventoryItems: inventory_items write returned ${savedRows.length} row(s), expected ${itemPayload.length} -- integrity check failed.`,
    );
    throw new Error("Some inventory item details could not be saved.");
  }
  const idBySku = new Map(savedRows.map((row) => [row.sku, row.id]));

  const locationId = await getMainWarehouseLocationId(accessToken);
  if (!locationId) {
    return;
  }
  const balancePayload = items
    .map((item) => {
      const inventoryItemId = idBySku.get(item.ref);
      return inventoryItemId ? { inventory_item_id: inventoryItemId, location_id: locationId, quantity_on_hand: item.stock, quantity_allocated: item.allocated ?? 0 } : null;
    })
    .filter((row): row is { inventory_item_id: string; location_id: string; quantity_on_hand: number; quantity_allocated: number } => row !== null);

  if (balancePayload.length === 0) {
    return;
  }
  // Migration 091 (quantity_allocated) is confirmed run in production
  // (2026-08-23) -- the old "retry without quantity_allocated on any 400"
  // fallback that used to sit here is deliberately removed, not just
  // untriggered. Blindly retrying every 400 assumed the *only* possible
  // 400 was the migration-091 column being missing, but any unrelated
  // validation error (a bad location_id, a constraint violation) would
  // have been silently swallowed by the same retry -- one bad batch could
  // "recover" via the fallback, appear to succeed, and still not save the
  // real quantities. That's the exact silent-partial-save shape this
  // whole fix exists to close, so it does not belong in the fix itself.
  // If a genuinely disconnected local/dev database ever needs this
  // compatibility again, it must inspect the response body for the
  // specific missing-column error, not retry on status code alone.
  const balanceResponse = await fetch(supabaseUrl("inventory_balances?on_conflict=inventory_item_id,location_id"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(balancePayload),
  });
  if (!balanceResponse.ok) {
    const bodyText = await balanceResponse.text().catch(() => "");
    console.error(`saveInventoryItems: inventory_balances write failed (${balanceResponse.status}): ${bodyText}`);
    throw new Error("Some inventory quantities could not be saved.");
  }
  // Same defensive posture as the item upsert above, just for on-hand/
  // allocated quantities instead of item metadata -- this write was
  // previously never checked at all. A 200/204 with a row count that
  // doesn't exactly match what was sent -- fewer or more -- is an
  // unexpected response cardinality worth rejecting as an integrity
  // anomaly, not a demonstrated RLS/constraint mechanism (see the item
  // upsert's own comment above: an ordinary RLS/constraint rejection
  // fails the whole statement, already caught by the .ok check above,
  // not just the offending row). The real status/count detail is logged
  // for diagnosis; the user only ever sees a plain, honest statement
  // that something didn't save.
  const savedBalanceRows = (await balanceResponse.json().catch(() => [])) as unknown[];
  if (savedBalanceRows.length !== balancePayload.length) {
    console.error(
      `saveInventoryItems: inventory_balances write returned ${savedBalanceRows.length} row(s), expected ${balancePayload.length} -- integrity check failed.`,
    );
    throw new Error("Some inventory quantities could not be saved.");
  }
}

// --- Phase 10d: Equipment Recipes (cut over from the app_records blob to the
// relational `equipment_types` + `equipment_bom_components` tables,
// migration 020) ------------------------------------------------------------
//
// Unlike Inventory Items, this can't be a single blind bulk upsert: BOM
// component lines can be removed in the app, and a naive upsert would only
// ever add/update rows, never delete the ones a user took out. So saving
// walks each recipe (there are only ever a handful of these, unlike
// inventory SKUs) and reconciles its component set explicitly.

export type BuildComponent = { itemName: string; qty: number };

// equipmentTypeId: the real, stable equipment_types.id, once known.
// Optional because it doesn't exist for a recipe that only lives in local
// state and hasn't been saved yet (a brand-new recipe before its first
// successful save). Sent back on every later save so the RPC updates the
// same row (and correctly handles a rename) instead of resolving by name,
// which is the exact bug PRODUCT_EQUIPMENT_RECIPE_ATOMIC_SAVE_PLAN.md §2a
// documents.
//
// clientId: a stable, purely client-side identity that exists from the
// moment a recipe is created (see createDeviceRecipeClientId()) and never
// changes for the life of that recipe in local state -- unlike
// equipmentTypeId (which starts undefined and only exists once the first
// save round-trips) and unlike `name` (user-editable). This is what
// saveDeviceRecipes' caller (the save queue below) uses to match a save
// result back to the right local recipe: matching by `name` broke the
// moment a recipe was renamed while its save was still in flight, since
// the server echo still carries the OLD name at that point. A loaded
// recipe derives clientId from its own equipmentTypeId (already stable and
// unique); a brand-new recipe is assigned one at creation time, before it
// has ever been saved.
export type BuildRecipe = {
  clientId: string;
  equipmentTypeId?: string;
  name: string;
  outputName: string;
  description: string;
  imageUrl?: string;
  components: BuildComponent[];
  retired?: boolean;
};

// crypto.randomUUID() with the same environment fallback generateShareToken
// (elsewhere in this file) already uses -- a single UUID is plenty of
// entropy for a purely local, never-persisted-to-the-database identity
// (it is never sent to the RPC or stored in any table; only
// equipmentTypeId is).
export function createDeviceRecipeClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

type EquipmentTypeRow = {
  id: string;
  equipment_name: string;
  description: string | null;
  image_url: string | null;
  is_retired: boolean;
  output_item: { item_name: string } | null;
  equipment_bom_components: Array<{ quantity_required: number | string; item: { item_name: string } | null }>;
};

const EQUIPMENT_TYPE_SELECT =
  "id,equipment_name,description,image_url,is_retired,output_item:inventory_items!output_inventory_item_id(item_name),equipment_bom_components(quantity_required,item:inventory_items(item_name))";

function mapEquipmentTypeRow(row: EquipmentTypeRow): BuildRecipe {
  return {
    // A loaded recipe's clientId is its own real id -- already stable and
    // unique, no separate generation needed.
    clientId: row.id,
    equipmentTypeId: row.id,
    name: row.equipment_name,
    outputName: row.output_item?.item_name ?? row.equipment_name,
    description: row.description ?? "",
    imageUrl: row.image_url ?? undefined,
    components: (row.equipment_bom_components ?? [])
      .filter((component) => component.item)
      .map((component) => ({ itemName: component.item!.item_name, qty: Number(component.quantity_required) || 0 })),
    retired: row.is_retired,
  };
}

// The raw jsonb shape migration 130's save_equipment_recipe() RPC returns.
// imageUrl comes back as a real JSON null when equipment_types.image_url
// is null -- JSON has no "undefined," so the RPC cannot return exactly
// BuildRecipe (whose imageUrl is `string | undefined`) without a mapping
// step. Chosen contract (E's preference, 2026-09-11): the RPC returns
// this raw shape as-is, and mapSaveEquipmentRecipeResult below is the one
// place that converts it into a real BuildRecipe, preserving BuildRecipe's
// existing null-to-undefined convention (matching mapEquipmentTypeRow's
// own `row.image_url ?? undefined` above) rather than changing BuildRecipe
// itself or every consumer that reads recipe.imageUrl today.
export type SaveEquipmentRecipeResult = {
  equipmentTypeId: string;
  name: string;
  outputName: string;
  description: string;
  imageUrl: string | null;
  retired: boolean;
  components: BuildComponent[];
};

// Called by saveDeviceRecipes below on every save_equipment_recipe RPC
// response. Returns everything BuildRecipe has EXCEPT clientId: the RPC
// has no concept of it (it is never sent as a parameter), so there is
// nothing here to map it from. The caller (the save queue below) is the
// one place that knows which local clientId a given result belongs to --
// via the request/result array's shared index, not anything in this
// return value.
export function mapSaveEquipmentRecipeResult(raw: SaveEquipmentRecipeResult): Omit<BuildRecipe, "clientId"> {
  return {
    equipmentTypeId: raw.equipmentTypeId,
    name: raw.name,
    outputName: raw.outputName,
    description: raw.description,
    imageUrl: raw.imageUrl ?? undefined,
    retired: raw.retired,
    components: raw.components,
  };
}

export async function loadDeviceRecipes(accessToken?: string): Promise<BuildRecipe[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl(`equipment_types?select=${EQUIPMENT_TYPE_SELECT}&order=equipment_name.asc`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as EquipmentTypeRow[];
  return rows.map(mapEquipmentTypeRow);
}

// Migration 130 moved this whole function's several separate,
// independently-committing PostgREST requests per recipe (equipment_types
// PATCH/INSERT, a bulk BOM upsert, a BOM cleanup DELETE, plus two upfront
// preflight lookups to catch bad component names before writing anything)
// into one atomic, security-definer RPC (rpc/save_equipment_recipe) --
// component-name resolution/ambiguity/duplicate checks, the
// equipment_types upsert, and the BOM reconciliation all happen inside a
// single Postgres transaction per recipe now, so a partial failure can no
// longer leave one recipe half-written the way the old multi-request
// version could. Recipes are still processed one at a time in a plain
// loop (not batched into one call) and this still stops at the first
// failing recipe rather than skip-and-continue -- same "no silent partial
// save" semantics as before, now backed by real per-recipe atomicity
// instead of just visibility into a non-atomic sequence.
//
// equipmentTypeId (an existing recipe's real, stable id, once loaded via
// loadDeviceRecipes) is sent as p_equipment_type_id so the RPC updates
// that exact row rather than re-resolving by name -- closing the
// rename-creates-a-duplicate bug that name-only resolution had. A brand
// new recipe (no equipmentTypeId yet) sends null and the RPC creates it.
//
// Returns one mapped result per input recipe, in the SAME order (index i
// of the result corresponds to index i of `recipes`) -- this is what lets
// a caller match a result back to the local recipe it belongs to via a
// stable clientId plus this shared index, rather than via `name` (see
// reconcileSavedDeviceRecipes below for why matching by name is unsafe: a
// rename while a save is in flight means the server echo still carries
// the OLD name). The result omits clientId entirely -- see
// mapSaveEquipmentRecipeResult's own comment for why.
export async function saveDeviceRecipes(recipes: BuildRecipe[], accessToken?: string): Promise<Array<Omit<BuildRecipe, "clientId">>> {
  if (!isRemotePersistenceConfigured() || !accessToken || recipes.length === 0) {
    return recipes;
  }

  const saved: Array<Omit<BuildRecipe, "clientId">> = [];
  for (const recipe of recipes) {
    const response = await fetch(supabaseUrl("rpc/save_equipment_recipe"), {
      method: "POST",
      headers: supabaseHeaders(accessToken),
      body: JSON.stringify({
        p_equipment_type_id: recipe.equipmentTypeId ?? null,
        p_equipment_name: recipe.name,
        p_description: recipe.description || null,
        p_image_url: recipe.imageUrl || null,
        p_retired: Boolean(recipe.retired),
        p_output_inventory_item_id: null,
        p_output_item_name: recipe.outputName || null,
        p_components: recipe.components.map((component, index) => ({
          item_name: component.itemName,
          quantity_required: component.qty,
          line_sort: index,
        })),
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
      console.error(`saveDeviceRecipes: save_equipment_recipe RPC failed for "${recipe.name}" (${response.status}):`, body);
      throw new Error("Some equipment recipes could not be saved.");
    }
    const raw = (await response.json()) as SaveEquipmentRecipeResult;
    saved.push(mapSaveEquipmentRecipeResult(raw));
  }
  return saved;
}

// Pure, no I/O, no React -- applies at most one field (equipmentTypeId)
// onto `current`, matched via each recipe's stable clientId plus the
// `requested`/`saved` arrays' shared index (saveDeviceRecipes returns one
// result per input recipe, in the same order -- see its own comment).
// Never matches by `name`: a rename that happens while a save is in
// flight would otherwise be lost, since `saved[i].name` still reflects
// whatever name was actually sent, not whatever the recipe has been
// renamed to since. Every other field is left exactly as `current` has
// it -- this only ever backfills an id, it never replaces a recipe with
// the (possibly now-stale) server echo, so edits made while the request
// was in flight are preserved untouched. Returns the exact same `current`
// array reference when nothing actually changed, so a caller using this
// inside a React state updater can safely skip a re-render (and, if
// nothing changed, does not need to re-save).
export function reconcileSavedDeviceRecipes(
  current: BuildRecipe[],
  requested: BuildRecipe[],
  saved: Array<Omit<BuildRecipe, "clientId">>,
): BuildRecipe[] {
  const backfill = new Map<string, string>();
  requested.forEach((recipe, index) => {
    const equipmentTypeId = saved[index]?.equipmentTypeId;
    if (equipmentTypeId) {
      backfill.set(recipe.clientId, equipmentTypeId);
    }
  });
  if (backfill.size === 0) {
    return current;
  }
  let changed = false;
  const next = current.map((recipe) => {
    const equipmentTypeId = backfill.get(recipe.clientId);
    if (equipmentTypeId && recipe.equipmentTypeId !== equipmentTypeId) {
      changed = true;
      return { ...recipe, equipmentTypeId };
    }
    return recipe;
  });
  return changed ? next : current;
}

// Serializes saveDeviceRecipes calls so a brand-new recipe (no
// equipmentTypeId yet) is never sent to the RPC with
// p_equipment_type_id: null more than once concurrently. Without this, a
// recipe created and then edited again before its first save returns
// could trigger a second, overlapping save that ALSO sends null (since
// the id backfill from the first call hasn't landed in local state yet)
// -- the RPC has no way to know the two calls mean "the same recipe," so
// it would create two separate equipment_types rows for one local recipe.
//
// enqueue() keeps only the single LATEST snapshot passed to it while a
// save is in flight (not a queue of every intermediate call) and runs it
// as exactly one follow-up save once the in-flight one settles, with the
// newly assigned id already merged in via reconcileSavedDeviceRecipes --
// so that follow-up sends the real id, never null again, even though the
// snapshot it was built from was captured before the id existed.
//
// applyReconciled is called with a plain state-updater function (the same
// shape React's setState accepts, e.g. `setDeviceRecipes`) specifically so
// the id backfill is always applied against whatever the true, live
// recipe state is at that moment -- never a snapshot this queue is
// holding onto itself, which could otherwise clobber edits a caller made
// while the request was in flight (requirement: preserve those edits).
export function createDeviceRecipeSaveQueue(
  applyReconciled: (updater: (current: BuildRecipe[]) => BuildRecipe[]) => void,
  onError: (error: unknown) => void,
) {
  let saving = false;
  let pending: { recipes: BuildRecipe[]; accessToken: string } | null = null;

  async function run(recipes: BuildRecipe[], accessToken: string): Promise<void> {
    saving = true;
    let saved: Array<Omit<BuildRecipe, "clientId">> | null = null;
    try {
      saved = await saveDeviceRecipes(recipes, accessToken);
      const result = saved;
      applyReconciled((current) => reconcileSavedDeviceRecipes(current, recipes, result));
    } catch (error) {
      onError(error);
    } finally {
      saving = false;
    }

    const next = pending;
    pending = null;
    if (next) {
      const followUpRecipes = saved ? reconcileSavedDeviceRecipes(next.recipes, recipes, saved) : next.recipes;
      void run(followUpRecipes, next.accessToken);
    }
  }

  return {
    enqueue(recipes: BuildRecipe[], accessToken: string): void {
      if (saving) {
        pending = { recipes, accessToken };
        return;
      }
      void run(recipes, accessToken);
    },
  };
}

// Bug found 2026-08-22: "Delete Equipment Type" only ever removed a recipe
// from local state -- saveDeviceRecipes above is upsert-only (it reconciles
// each recipe's own BOM component lines, but never notices a whole recipe
// is now missing from the array), so the equipment_types row survived and
// the "deleted" recipe silently reappeared on next reload. Real delete,
// called directly from the delete action instead of relying on the
// debounced whole-array sync. Retire (is_retired) already exists as the
// "hide but keep for history" path -- this is for recipes the user
// actually wants gone, so a real DB delete (not soft) is correct here;
// still logged to deletion_log for accountability.
export async function deleteEquipmentType(name: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const lookupResponse = await fetch(supabaseUrl(`equipment_types?equipment_name=eq.${encodeURIComponent(name)}&select=id`), {
    headers: supabaseHeaders(accessToken),
  });
  const lookupRows = lookupResponse.ok ? ((await lookupResponse.json()) as Array<{ id: string }>) : [];
  const equipmentTypeId = lookupRows[0]?.id;
  if (!equipmentTypeId) {
    // A recipe created this session only exists in local React state until
    // the debounced whole-array save (saveDeviceRecipes, up to 650ms behind)
    // writes it to equipment_types -- deleting it right after creating it
    // used to hit this lookup before that write landed, come back empty,
    // and fail with an error the caller had no visible way to show. Nothing
    // real exists yet to delete or log, so this is a success, not a failure.
    return { ok: true };
  }
  const response = await fetch(supabaseUrl(`equipment_types?id=eq.${equipmentTypeId}`), {
    method: "DELETE",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
  });
  if (!response.ok) {
    // build_transactions.equipment_type_id has no ON DELETE clause (defaults
    // to RESTRICT), so this fails with a real FK-violation error whenever
    // the recipe has ever actually been built -- surface that plainly
    // rather than a raw Postgres error.
    if (response.status === 409) {
      return { ok: false, error: "Can't delete -- this equipment type has build history. Use Retire instead to keep it out of the picker without losing that history." };
    }
    return { ok: false, error: await readSupabaseError(response, "Could not delete equipment type") };
  }
  // `return=representation` so a DELETE that matched 0 rows (e.g. blocked by
  // an RLS policy) can be told apart from a real delete -- PostgREST returns
  // 200/204 either way, so response.ok alone can't tell a silent no-op from
  // an actual row removal, and logging the former as "deleted" would be a
  // false audit entry.
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't remove anything -- you may not have permission to delete equipment types." };
  }
  await logDeletionEvent("equipment_type", equipmentTypeId, name, "deleted", actorEmail, accessToken);
  return { ok: true };
}

// --- Phase 10e: Inventory Movements, Build Transactions, Project Allocation
// History (cut over from the app_records blob to the relational
// inventory_movements / build_transactions / project_allocation_history
// tables, migration 021 -- also needs migration 030, which relaxes two
// check constraints on inventory_movements the original schema had that
// don't match how this app actually posts movements: retire/reactivate
// movements carry a 0 quantity, and this app has no from/to-location
// concept at all.) ------------------------------------------------------
//
// Like Inventory Items and Equipment Recipes, this keeps the "load once,
// debounce-save the whole array" shape rather than converting every
// append call site (pull/receive/transfer/build-consume/build-complete/
// undo/retire/reactivate) into its own network call. Save order matters:
// build transactions first (so movements can resolve build_transaction_id
// by build_number), then movements (so allocations can resolve movement_id
// by legacy_id), then allocations -- same order the migration itself used.

export type InventoryMovement = {
  id: string;
  type: "receive" | "transfer" | "build_consume" | "build_complete" | "adjust" | "retire" | "reactivate" | "undo";
  sku: string;
  itemName: string;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  projectName?: string;
  poNumber?: string;
  buildNumber?: string;
  source: "inventory" | "project" | "purchasing" | "equipment";
  notes: string;
  createdAt: string;
  createdByEmail?: string;
};

export type BuildTransaction = {
  id: string;
  buildNumber: string;
  equipmentName: string;
  quantityBuilt: number;
  componentMovements: InventoryMovement[];
  completionMovement?: InventoryMovement;
  status: "planned" | "posted" | "undone" | "cancelled";
  stage?: "planned" | "kitting" | "assembled" | "tested" | "complete";
  createdAt: string;
  undoneAt?: string;
};

export type ProjectAllocationHistory = {
  id: string;
  projectName: string;
  projectRef?: string;
  sku: string;
  itemName: string;
  quantity: number;
  movementId: string;
  action: "allocated" | "returned" | "adjusted" | "undone";
  notes: string;
  createdAt: string;
};

function appMovementType(type: string): InventoryMovement["type"] {
  switch (type) {
    case "receipt": return "receive";
    case "adjustment": return "adjust";
    case "transfer": return "transfer";
    case "build_consume": return "build_consume";
    case "build_complete": return "build_complete";
    case "retire": return "retire";
    case "reactivate": return "reactivate";
    case "undo": return "undo";
    default: return "adjust";
  }
}

function pgMovementType(type: InventoryMovement["type"]): string {
  switch (type) {
    case "receive": return "receipt";
    case "adjust": return "adjustment";
    default: return type;
  }
}

type InventoryMovementRow = {
  legacy_id: string;
  movement_type: string;
  quantity: number | string;
  balance_before: number | string;
  balance_after: number | string;
  reference_number: string | null;
  notes: string | null;
  created_at: string;
  performed_by_email: string | null;
  inventory_item: { sku: string; item_name: string } | null;
  project: { project_name: string } | null;
  build_transaction: { build_number: string } | null;
};

const INVENTORY_MOVEMENT_SELECT =
  "legacy_id,movement_type,quantity,balance_before,balance_after,reference_number,notes,created_at,performed_by_email,inventory_item:inventory_items(sku,item_name),project:projects(project_name),build_transaction:build_transactions(build_number)";

function mapInventoryMovementRow(row: InventoryMovementRow): InventoryMovement {
  const type = appMovementType(row.movement_type);
  const projectName = row.project?.project_name ?? undefined;
  const buildNumber = row.build_transaction?.build_number ?? undefined;
  const poNumber = row.reference_number ?? undefined;
  let source: InventoryMovement["source"] = "inventory";
  if (type === "build_consume" || type === "build_complete" || buildNumber) {
    source = "equipment";
  } else if (projectName) {
    source = "project";
  } else if (poNumber || type === "receive") {
    source = "purchasing";
  }
  return {
    id: row.legacy_id,
    type,
    sku: row.inventory_item?.sku ?? "",
    itemName: row.inventory_item?.item_name ?? "",
    quantity: Number(row.quantity) || 0,
    quantityBefore: Number(row.balance_before) || 0,
    quantityAfter: Number(row.balance_after) || 0,
    projectName,
    poNumber,
    buildNumber,
    source,
    notes: row.notes ?? "",
    createdAt: row.created_at,
    createdByEmail: row.performed_by_email ?? "",
  };
}

// E, via an audit request: "loadInventoryMovements currently returns []
// when the REST request fails, which makes a database or permission
// error look like an honest empty ledger." Confirmed real -- this is
// exactly the shape of bug that hid migration 070 being unapplied for
// days (Reports > Activity Ledger showed "No inventory movements match
// the current filters," which read as genuinely empty data). Throws
// now instead of swallowing, so a real failure surfaces as a real
// failure at the call site instead of masquerading as zero rows.
export async function loadInventoryMovements(accessToken?: string): Promise<InventoryMovement[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(
    supabaseUrl(`inventory_movements?select=${INVENTORY_MOVEMENT_SELECT}&legacy_id=not.is.null&order=created_at.desc&limit=2000`),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    throw new Error(await readSupabaseError(response, "Could not load inventory movements"));
  }
  const rows = (await response.json()) as InventoryMovementRow[];
  return rows.map(mapInventoryMovementRow);
}

type BuildTransactionRow = {
  build_number: string;
  quantity_built: number | string;
  status: string;
  workflow_stage: string | null;
  created_at: string;
  undone_at: string | null;
  equipment_type: { equipment_name: string } | null;
};

const BUILD_TRANSACTION_SELECT = "build_number,quantity_built,status,workflow_stage,created_at,undone_at,equipment_type:equipment_types(equipment_name)";

export async function loadBuildTransactions(accessToken?: string): Promise<BuildTransaction[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const [buildsResponse, movements] = await Promise.all([
    fetch(supabaseUrl(`build_transactions?select=${BUILD_TRANSACTION_SELECT}&deleted_at=is.null&order=created_at.desc&limit=2000`), { headers: supabaseHeaders(accessToken) }),
    loadInventoryMovements(accessToken),
  ]);
  // Migration 098 safety net: if deleted_at doesn't exist yet, the filtered
  // query 400s -- retry without it so Builds isn't blank until the
  // migration runs (deleted builds just won't be hideable yet).
  const finalResponse = buildsResponse.ok
    ? buildsResponse
    : await fetch(supabaseUrl(`build_transactions?select=${BUILD_TRANSACTION_SELECT}&order=created_at.desc&limit=2000`), { headers: supabaseHeaders(accessToken) });
  if (!finalResponse.ok) {
    return [];
  }
  const rows = (await finalResponse.json()) as BuildTransactionRow[];
  const movementsByBuild = new Map<string, InventoryMovement[]>();
  movements.forEach((movement) => {
    if (!movement.buildNumber) {
      return;
    }
    const list = movementsByBuild.get(movement.buildNumber) ?? [];
    list.push(movement);
    movementsByBuild.set(movement.buildNumber, list);
  });
  return rows.map((row) => {
    const buildMovements = movementsByBuild.get(row.build_number) ?? [];
    return {
      id: row.build_number,
      buildNumber: row.build_number,
      equipmentName: row.equipment_type?.equipment_name ?? "",
      quantityBuilt: Number(row.quantity_built) || 0,
      componentMovements: buildMovements.filter((movement) => movement.type === "build_consume"),
      completionMovement: buildMovements.find((movement) => movement.type === "build_complete"),
      status: (row.status as BuildTransaction["status"]) ?? "posted",
      stage: (row.workflow_stage as BuildTransaction["stage"]) ?? undefined,
      createdAt: row.created_at,
      undoneAt: row.undone_at ?? undefined,
    };
  });
}

export async function saveBuildTransactions(builds: BuildTransaction[], accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken || builds.length === 0) {
    return;
  }
  // Correction (2026-09-11, review): a failed lookup used to silently
  // degrade to an empty map, which meant every build in this save would be
  // written with a null equipment_type_id/finished_inventory_item_id --
  // not because the equipment name was genuinely unmatched, but because the
  // read itself failed (network error, RLS, a bad token). That's a false
  // "unmatched" outcome hiding a real infrastructure failure. Now: an
  // HTTP/network failure on this lookup is a hard stop before any write.
  //
  // Fixed 2026-09-12 (overnight reliability closeout part 2, task 4,
  // a real defect found during optional-association tracing): this
  // lookup used to key equipment ONLY by equipment_types.equipment_name,
  // but build.equipmentName is populated from a recipe's OUTPUT name
  // (BuildRecipe.outputName), not its internal `name`. The two start out
  // equal when a recipe is first created, but silently diverge the
  // moment a user edits the "Equipment title" field (bound to
  // outputName) without renaming the recipe's own internal name -- after
  // which every future build of that equipment type got written with
  // equipment_type_id/finished_inventory_item_id null, with the name
  // lookup having "succeeded" the whole time. Several read-side lookups
  // elsewhere in this app already defensively check both fields for
  // exactly this reason (e.g. `item.outputName === build.equipmentName
  // || item.name === build.equipmentName`) -- this lookup now does the
  // same, resolving by output name first, then by the recipe's own name.
  let equipmentRows: Array<{ id: string; equipment_name: string; output_inventory_item_id: string | null; output_item: { item_name: string } | null }>;
  try {
    const equipmentResponse = await fetch(
      supabaseUrl("equipment_types?select=id,equipment_name,output_inventory_item_id,output_item:inventory_items!output_inventory_item_id(item_name)"),
      { headers: supabaseHeaders(accessToken) },
    );
    if (!equipmentResponse.ok) {
      const bodyText = await equipmentResponse.text().catch(() => "");
      console.error(`saveBuildTransactions: equipment_types lookup failed (${equipmentResponse.status}): ${bodyText}`);
      throw new Error("Some build transactions could not be saved.");
    }
    equipmentRows = (await equipmentResponse.json()) as Array<{ id: string; equipment_name: string; output_inventory_item_id: string | null; output_item: { item_name: string } | null }>;
  } catch (error) {
    if (error instanceof Error && error.message === "Some build transactions could not be saved.") {
      throw error;
    }
    console.error("saveBuildTransactions: equipment_types lookup network error:", error);
    // tsconfig targets ES2020, whose Error type has no two-arg (message,
    // options) constructor overload -- every modern runtime this app
    // actually ships to supports `cause` at runtime regardless, so it's
    // attached as a plain property instead of via the constructor arg.
    const wrapped = new Error("Some build transactions could not be saved.");
    (wrapped as Error & { cause?: unknown }).cause = error;
    throw wrapped;
  }
  const equipmentByEquipmentName = new Map(equipmentRows.map((row) => [row.equipment_name, row]));
  const equipmentByOutputName = new Map(
    equipmentRows
      .filter((row): row is typeof row & { output_item: { item_name: string } } => Boolean(row.output_item?.item_name))
      .map((row) => [row.output_item.item_name, row]),
  );
  function resolveEquipment(name: string) {
    return equipmentByOutputName.get(name) ?? equipmentByEquipmentName.get(name);
  }

  // Added 2026-09-12 (overnight reliability closeout part 2, task 4): a
  // genuinely unmatched equipment NAME (non-blank, the lookup succeeded,
  // it just isn't in the result) now rejects the whole save up front,
  // naming every affected build -- rather than silently writing
  // equipment_type_id/finished_inventory_item_id as null. A blank
  // equipmentName is not treated as an error here (unlike a blank sku in
  // saveInventoryMovements below): equipment_type_id has no NOT NULL
  // constraint (migration 003), so "no equipment specified" is a
  // legitimate, schema-permitted state, not a resolution failure.
  const unresolvedEquipment = builds.filter((build) => build.equipmentName.trim().length > 0 && !resolveEquipment(build.equipmentName));
  if (unresolvedEquipment.length > 0) {
    const detail = unresolvedEquipment.map((build) => `${build.buildNumber} (equipment "${build.equipmentName}")`).join(", ");
    console.error(`saveBuildTransactions: unresolved equipment name for build(s): ${detail}`);
    throw new Error("Some build transactions could not be saved.");
  }

  const payload = builds.map((build) => {
    const equipment = resolveEquipment(build.equipmentName);
    return {
      build_number: build.buildNumber,
      equipment_type_id: equipment?.id ?? null,
      finished_inventory_item_id: equipment?.output_inventory_item_id ?? null,
      quantity_built: build.quantityBuilt,
      status: build.status,
      workflow_stage: build.stage ?? "complete",
      created_at: build.createdAt,
      undone_at: build.undoneAt ?? null,
    };
  });
  // Overnight audit (2026-09-11, task 5): this POST was completely
  // unchecked. Safe to verify here -- both callers already have a real
  // handled-failure path: the live debounce-save effect (main.tsx) wraps
  // this via saveMovementsBuildsAllocations in a .catch that sets a
  // visible setAuthStatus/setSyncStatus("error") message, and the restore
  // path's only caller has its own honest try/catch (see
  // saveRestoredPurchaseRequests above) -- an isolated response check,
  // not a redesign of either caller.
  const response = await fetch(supabaseUrl("build_transactions?on_conflict=build_number"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`saveBuildTransactions failed (${response.status}): ${bodyText}`);
    throw new Error("Some build transactions could not be saved.");
  }
  const savedRows = (await response.json().catch(() => [])) as unknown[];
  if (savedRows.length !== payload.length) {
    console.error(`saveBuildTransactions returned ${savedRows.length} row(s), expected ${payload.length} -- integrity check failed.`);
    throw new Error("Some build transactions could not be saved.");
  }
}

// E: "I need to be able to delete these [cancelled/undone builds], it
// should just log if any user does, but i don't want a long list of
// cancelled items." Soft-delete only -- build_number is the natural key
// here since BuildTransaction.id IS the build_number (never a raw uuid
// in the app layer), and the whole-array upsert in saveBuildTransactions
// above never touches deleted_at/deleted_by_email, so a repeat debounced
// save can't accidentally resurrect a deleted build.
export async function deleteBuildTransaction(buildNumber: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`build_transactions?build_number=eq.${encodeURIComponent(buildNumber)}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete build") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ build_number: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("build_transaction", buildNumber, buildNumber, "deleted", actorEmail, accessToken);
  return { ok: true };
}

type ProjectAllocationRow = {
  legacy_id: string;
  action: string;
  quantity: number | string;
  project_name_snapshot: string | null;
  sku_snapshot: string | null;
  item_name_snapshot: string | null;
  notes: string | null;
  created_at: string;
  movement: { legacy_id: string } | null;
  project: { project_number: string | null } | null;
};

const PROJECT_ALLOCATION_SELECT =
  "legacy_id,action,quantity,project_name_snapshot,sku_snapshot,item_name_snapshot,notes,created_at,movement:inventory_movements(legacy_id),project:projects(project_number)";

function mapProjectAllocationRow(row: ProjectAllocationRow): ProjectAllocationHistory {
  return {
    id: row.legacy_id,
    projectName: row.project_name_snapshot ?? "",
    projectRef: row.project?.project_number ?? undefined,
    sku: row.sku_snapshot ?? "",
    itemName: row.item_name_snapshot ?? "",
    quantity: Number(row.quantity) || 0,
    movementId: row.movement?.legacy_id ?? "",
    action: (row.action as ProjectAllocationHistory["action"]) ?? "allocated",
    notes: row.notes ?? "",
    createdAt: row.created_at,
  };
}

// NOTE: this loader was missing entirely through the first pass of the
// Phase 10e cutover -- builds and movements got reloaded on refresh, but
// allocation history didn't, so it silently reset to empty every session
// even though the rows were safe in Postgres the whole time. Fixed here.
export async function loadProjectAllocations(accessToken?: string): Promise<ProjectAllocationHistory[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(
    supabaseUrl(`project_allocation_history?select=${PROJECT_ALLOCATION_SELECT}&legacy_id=not.is.null&order=created_at.desc&limit=2000`),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as ProjectAllocationRow[];
  return rows.map(mapProjectAllocationRow);
}

async function lookupRowsOrThrow<T>(callerLabel: string, lookupLabel: string, path: string, accessToken: string, userMessage: string): Promise<T[]> {
  let response: Response;
  try {
    response = await fetch(supabaseUrl(path), { headers: supabaseHeaders(accessToken) });
  } catch (error) {
    console.error(`${callerLabel}: ${lookupLabel} lookup network error:`, error);
    // See the matching comment in saveBuildTransactions above -- ES2020 lib
    // has no two-arg Error constructor overload, so cause is attached as a
    // plain property instead.
    const wrapped = new Error(userMessage);
    (wrapped as Error & { cause?: unknown }).cause = error;
    throw wrapped;
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`${callerLabel}: ${lookupLabel} lookup failed (${response.status}): ${bodyText}`);
    throw new Error(userMessage);
  }
  return (await response.json()) as T[];
}

// A movement whose sku is missing or all-whitespace cannot be persisted
// correctly regardless of whether any lookup succeeds -- inventory_item_id
// is NOT NULL on inventory_movements (migration 001). Whitespace is
// deliberately not treated as a valid sku anywhere this is checked, so a
// stray-space value can't slip past a truthiness check and still fail to
// resolve later.
function isBlankSku(sku: string | null | undefined): boolean {
  return !sku || sku.trim().length === 0;
}

export async function saveInventoryMovements(movements: InventoryMovement[], accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken || movements.length === 0) {
    return;
  }

  // Correction (2026-09-11, review): a movement with a missing or
  // whitespace-only sku used to be silently filtered out of the write
  // entirely -- the same data-loss shape this whole pass exists to remove,
  // and it needs no business decision to reject: the column simply cannot
  // hold a movement with no resolvable item. Checked BEFORE any lookup or
  // write, and before the unresolved-sku check further below (which only
  // catches a sku that IS present but doesn't match a real inventory_items
  // row -- a different case from this one).
  const blankSkuMovements = movements.filter((m) => isBlankSku(m.sku));
  if (blankSkuMovements.length > 0) {
    const detail = blankSkuMovements.map((m) => m.id).join(", ");
    console.error(`saveInventoryMovements: missing/blank sku for movement(s): ${detail}`);
    throw new Error("Some inventory movements could not be saved.");
  }

  const skus = Array.from(new Set(movements.map((m) => m.sku).filter((sku) => !isBlankSku(sku))));
  const projectNames = Array.from(new Set(movements.map((m) => m.projectName).filter((name): name is string => Boolean(name))));
  const buildNumbers = Array.from(new Set(movements.map((m) => m.buildNumber).filter((n): n is string => Boolean(n))));

  // Correction (2026-09-11, review): each of these three lookups used to
  // collapse an HTTP/network failure into an empty array -- indistinguishable
  // from "genuinely no matching rows." For the sku lookup specifically that
  // was dangerous: inventory_item_id is NOT NULL on inventory_movements
  // (migration 001), so a failed lookup meant every movement in the batch
  // was silently dropped from the write with no error raised at all (see
  // the unresolved-sku check below, which now replaces that silent drop).
  // project_id and build_transaction_id are both nullable FKs (migrations
  // 001, 021, 075) -- an EMPTY projectName/buildNumber still safely
  // resolves to null (a movement genuinely not tied to a project/build).
  // Updated 2026-09-12 (overnight reliability closeout part 2, task 4):
  // a NONEMPTY project/build name that fails to resolve is no longer
  // tolerated as silent-null -- see the unresolved-project/build check
  // below, implementing the decided "warn and require correction"
  // policy for this optional association.
  const [itemRows, projectRows, buildRows] = await Promise.all([
    skus.length
      ? lookupRowsOrThrow<{ id: string; sku: string }>("saveInventoryMovements", "inventory_items", `inventory_items?select=id,sku&sku=in.(${skus.map((s) => `"${s}"`).join(",")})`, accessToken, "Some inventory movements could not be saved.")
      : Promise.resolve([]),
    projectNames.length
      ? lookupRowsOrThrow<{ id: string; project_name: string }>("saveInventoryMovements", "projects", `projects?select=id,project_name&project_name=in.(${projectNames.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(",")})`, accessToken, "Some inventory movements could not be saved.")
      : Promise.resolve([]),
    buildNumbers.length
      ? lookupRowsOrThrow<{ id: string; build_number: string }>("saveInventoryMovements", "build_transactions", `build_transactions?select=id,build_number&build_number=in.(${buildNumbers.map((n) => `"${n}"`).join(",")})`, accessToken, "Some inventory movements could not be saved.")
      : Promise.resolve([]),
  ]);

  const itemIdBySku = new Map(itemRows.map((row) => [row.sku, row.id]));
  const projectIdByName = new Map(projectRows.map((row) => [row.project_name, row.id]));
  const buildIdByNumber = new Map(buildRows.map((row) => [row.build_number, row.id]));

  // Correction (2026-09-11, review): a movement with a genuinely nonempty
  // sku that doesn't resolve to a real inventory_items row used to be
  // silently filtered out of the write entirely, with only a payload-length
  // mismatch (never actually checked against the ORIGINAL movement count)
  // as a trace. Reject the whole save up front, before any write, naming
  // every unresolved sku/movement so the failure is diagnosable. Every
  // movement here is guaranteed to have a real, nonblank sku by this point
  // (the blank-sku preflight above already rejected the whole save
  // otherwise) -- this check only catches a sku that's present but doesn't
  // match a real catalog row.
  const unresolved = movements.filter((m) => !itemIdBySku.has(m.sku));
  if (unresolved.length > 0) {
    const detail = unresolved.map((m) => `${m.id} (sku ${m.sku})`).join(", ");
    console.error(`saveInventoryMovements: unresolved sku for movement(s): ${detail}`);
    throw new Error("Some inventory movements could not be saved.");
  }

  // Added 2026-09-12 (overnight reliability closeout part 2, task 4 --
  // implementing the decided "warn/reject instead of silently null"
  // policy for these two optional associations). A genuinely nonempty
  // projectName/buildNumber that doesn't resolve to a real row now
  // rejects the whole save up front, naming every affected movement and
  // its unresolved value -- the same treatment already given to sku
  // above, extended to these two nullable FKs. A movement that never
  // specified a project/build at all (empty string/undefined) is
  // unaffected -- that remains a legitimate "not associated with a
  // project or build" state, not a resolution failure.
  const unresolvedProject = movements.filter((m) => m.projectName && !projectIdByName.has(m.projectName));
  const unresolvedBuild = movements.filter((m) => m.buildNumber && !buildIdByNumber.has(m.buildNumber));
  if (unresolvedProject.length > 0 || unresolvedBuild.length > 0) {
    const detail = [
      ...unresolvedProject.map((m) => `${m.id} (project "${m.projectName}")`),
      ...unresolvedBuild.map((m) => `${m.id} (build "${m.buildNumber}")`),
    ].join(", ");
    console.error(`saveInventoryMovements: unresolved project/build for movement(s): ${detail}`);
    throw new Error("Some inventory movements could not be saved.");
  }

  // No filter here (unlike before this review): every movement in
  // `movements` is guaranteed present in the payload now -- blank skus and
  // unresolved skus/projects/builds were all already rejected above, not
  // silently dropped.
  const payload = movements
    .map((movement) => ({
      legacy_id: movement.id,
      movement_type: pgMovementType(movement.type),
      inventory_item_id: itemIdBySku.get(movement.sku)!,
      quantity: movement.quantity,
      project_id: movement.projectName ? projectIdByName.get(movement.projectName) ?? null : null,
      reference_number: movement.poNumber ?? null,
      build_transaction_id: movement.buildNumber ? buildIdByNumber.get(movement.buildNumber) ?? null : null,
      movement_date: movement.createdAt,
      balance_before: movement.quantityBefore,
      balance_after: movement.quantityAfter,
      notes: movement.notes,
      created_at: movement.createdAt,
      performed_by_email: movement.createdByEmail || null,
    }));

  const response = await fetch(supabaseUrl("inventory_movements?on_conflict=legacy_id"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`saveInventoryMovements failed (${response.status}): ${bodyText}`);
    throw new Error("Some inventory movements could not be saved.");
  }
  const savedRows = (await response.json().catch(() => [])) as unknown[];
  if (savedRows.length !== payload.length) {
    console.error(`saveInventoryMovements returned ${savedRows.length} row(s), expected ${payload.length} -- integrity check failed.`);
    throw new Error("Some inventory movements could not be saved.");
  }
}

export async function saveProjectAllocations(allocations: ProjectAllocationHistory[], accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken || allocations.length === 0) {
    return;
  }
  const skus = Array.from(new Set(allocations.map((a) => a.sku).filter(Boolean)));
  const projectNames = Array.from(new Set(allocations.map((a) => a.projectName).filter(Boolean)));
  const movementLegacyIds = Array.from(new Set(allocations.map((a) => a.movementId).filter(Boolean)));

  // Correction (2026-09-11, review): these three lookups used to collapse
  // an HTTP/network failure into an empty array, same gap as
  // saveInventoryMovements above. All three FKs here (project_id,
  // inventory_item_id, movement_id on project_allocation_history,
  // migration 003) are genuinely nullable -- none is NOT NULL -- so an
  // EMPTY name/sku/legacy id still safely resolves to null, unchanged
  // from before. Updated 2026-09-12 (overnight reliability closeout part
  // 2, task 4): a NONEMPTY value that fails to resolve is no longer
  // tolerated as silent-null -- see the unresolved check below,
  // implementing the decided "warn and require correction" policy for
  // these three optional associations (this was previously documented
  // here as an accepted limitation; that framing is now superseded).
  const [itemRows, projectRows, movementRows] = await Promise.all([
    skus.length
      ? lookupRowsOrThrow<{ id: string; sku: string }>("saveProjectAllocations", "inventory_items", `inventory_items?select=id,sku&sku=in.(${skus.map((s) => `"${s}"`).join(",")})`, accessToken, "Some project allocations could not be saved.")
      : Promise.resolve([]),
    projectNames.length
      ? lookupRowsOrThrow<{ id: string; project_name: string }>("saveProjectAllocations", "projects", `projects?select=id,project_name&project_name=in.(${projectNames.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(",")})`, accessToken, "Some project allocations could not be saved.")
      : Promise.resolve([]),
    movementLegacyIds.length
      ? lookupRowsOrThrow<{ id: string; legacy_id: string }>("saveProjectAllocations", "inventory_movements", `inventory_movements?select=id,legacy_id&legacy_id=in.(${movementLegacyIds.map((id) => `"${id}"`).join(",")})`, accessToken, "Some project allocations could not be saved.")
      : Promise.resolve([]),
  ]);

  const itemIdBySku = new Map(itemRows.map((row) => [row.sku, row.id]));
  const projectIdByName = new Map(projectRows.map((row) => [row.project_name, row.id]));
  const movementIdByLegacyId = new Map(movementRows.map((row) => [row.legacy_id, row.id]));

  // Added 2026-09-12 (overnight reliability closeout part 2, task 4): a
  // genuinely nonempty sku/projectName/movementId that doesn't resolve
  // now rejects the whole save up front, naming every affected
  // allocation and its unresolved value(s) -- an allocation that never
  // specified one of these at all (empty/undefined) is unaffected, that
  // remains a legitimate unassociated state.
  const unresolvedAllocations = allocations.filter(
    (a) =>
      (a.sku && !itemIdBySku.has(a.sku)) ||
      (a.projectName && !projectIdByName.has(a.projectName)) ||
      (a.movementId && !movementIdByLegacyId.has(a.movementId)),
  );
  if (unresolvedAllocations.length > 0) {
    const detail = unresolvedAllocations
      .map((a) => {
        const problems: string[] = [];
        if (a.sku && !itemIdBySku.has(a.sku)) problems.push(`sku "${a.sku}"`);
        if (a.projectName && !projectIdByName.has(a.projectName)) problems.push(`project "${a.projectName}"`);
        if (a.movementId && !movementIdByLegacyId.has(a.movementId)) problems.push(`movement "${a.movementId}"`);
        return `${a.id} (${problems.join(", ")})`;
      })
      .join(", ");
    console.error(`saveProjectAllocations: unresolved association for allocation(s): ${detail}`);
    throw new Error("Some project allocations could not be saved.");
  }

  const payload = allocations.map((allocation) => ({
    legacy_id: allocation.id,
    allocation_number: `ALLOC-${allocation.id}`,
    project_id: projectIdByName.get(allocation.projectName) ?? null,
    inventory_item_id: itemIdBySku.get(allocation.sku) ?? null,
    movement_id: movementIdByLegacyId.get(allocation.movementId) ?? null,
    action: allocation.action,
    quantity: allocation.quantity,
    project_name_snapshot: allocation.projectName,
    sku_snapshot: allocation.sku,
    item_name_snapshot: allocation.itemName,
    notes: allocation.notes,
    created_at: allocation.createdAt,
  }));
  // Overnight audit (2026-09-11, task 5): same unchecked-POST gap and the
  // same two already-safe callers as saveBuildTransactions above.
  const response = await fetch(supabaseUrl("project_allocation_history?on_conflict=legacy_id"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`saveProjectAllocations failed (${response.status}): ${bodyText}`);
    throw new Error("Some project allocations could not be saved.");
  }
  const savedRows = (await response.json().catch(() => [])) as unknown[];
  if (savedRows.length !== payload.length) {
    console.error(`saveProjectAllocations returned ${savedRows.length} row(s), expected ${payload.length} -- integrity check failed.`);
    throw new Error("Some project allocations could not be saved.");
  }
}

// Orchestrates the three saves above in the order their foreign keys
// require: builds, then movements (needs build ids), then allocations
// (needs movement ids).
export async function saveMovementsBuildsAllocations(
  builds: BuildTransaction[],
  movements: InventoryMovement[],
  allocations: ProjectAllocationHistory[],
  accessToken?: string,
): Promise<void> {
  await saveBuildTransactions(builds, accessToken);
  await saveInventoryMovements(movements, accessToken);
  await saveProjectAllocations(allocations, accessToken);
}

// --- Phase 10f: Projects, Scope of Work, and BOM lines (cut over from the
// app_records blob to the relational `projects` table plus two new tables,
// `project_scope_of_work` and `project_bom_lines`, migration 022) ----------
//
// Same "load once, debounce-save the whole array" shape as Inventory Items
// and Equipment Recipes: none of the add-project/edit-SOW/edit-BOM-line
// logic in the Projects component needs to change, only where it's
// persisted. BOM lines have no natural per-line key (same as the original
// migration's own comment), so saving wholesale replaces a project's line
// set rather than trying to reconcile it row by row.

export type ScopeOfWork = {
  summary: string;
  preparation: string;
  infrastructure: string;
  installation: string;
  commissioning: string;
  fineTuning: string;
  assumptions: string;
  exclusions: string;
};

export type BomLine = {
  // Stable identity used only by the browser while a brand-new line is
  // waiting for its first database id. Loaded lines use their real id.
  clientId?: string;
  // The real, stable project_bom_lines.id, once known (migration 131's
  // replace_project_bom_lines RPC). Undefined for a line that only exists
  // in local state and hasn't round-tripped through a save yet (a
  // brand-new line before its first successful save) -- sent back on
  // every later save so the RPC updates that exact row (reconcile-by-id)
  // instead of always inserting a new one.
  id?: string;
  // The real, stable inventory_items.sku this line's catalog item
  // resolves to, once known -- the app-wide convention for referencing an
  // inventory item by a stable identifier (see Part.sku,
  // resolveInventoryItemIdBySku) rather than by its mutable display name.
  // Undefined for a line with no catalog link yet, or one whose item name
  // hasn't matched a catalog row (tolerated, not an error -- see
  // migration 131). `item` remains the line's own display-name snapshot
  // regardless of whether sku is set; sku is never used to overwrite it.
  sku?: string;
  item: string;
  qty: number;
  status: "Need Quote" | "Not started" | "Ordered" | "Completed" | "From Inventory" | "Delivered to Office" | "Delivered to Client";
  requestSpeed: "ASAP" | "Standard" | "Future";
  po?: string;
  notes?: string;
  // Procurement approval gate: which fulfillment path this line is meant to
  // take once it's sent -- "pull" from existing inventory, or a Purchasing
  // request either into warehouse stock or direct to the project. Set when
  // the line is added, but not acted on until sentToPurchasingAt is set.
  // Optional (defaults to "warehouse_stock") so the many hardcoded/demo BOM
  // arrays elsewhere in the app don't all need updating just to type-check.
  procurementTrack?: "pull" | "warehouse_stock" | "direct_to_project";
  // Undefined/null until a manager/PM sends this line to Procurement (only
  // possible once the project's submittal is client-approved) -- see
  // main.tsx's handleSendBomToPurchasing. Prevents a repeat click from
  // double-queuing the same purchase request or inventory pull.
  sentToPurchasingAt?: string | null;
  // Migration 079: where this line ships -- "EnSight Office," "Project
  // Site," or one of the project's saved Shipping Addresses (see Address
  // Book). Plain text snapshot, same convention as PurchaseOrder.shipTo
  // and ProjectShipment.addressSnapshot -- not an FK, so it survives even
  // if the saved address it was picked from is later edited or removed.
  shipTo?: string;
};

export function createProjectBomLineClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

// Migration 064: the Project-side mirror of SalesQuoteLocation/Image/Item
// (see below in this file) -- same per-garage/lot shape (camera picks,
// entries/exits/levels, signs/sensors/misc lines, photos/drawings) so a
// closed-won quote's site breakdown carries over into its Project in the
// same format, and the PM/field team can keep adding to it through
// implementation and closeout. Deliberately structurally identical to
// SalesQuoteLocation/Image/Item (not the same type) so the shared UI
// components (LocationFilesModal, SiteGalleryModal, CameraCaptureModal)
// can work against either via a common "Like" shape without caring which
// side it's on.
export type ProjectLocationImage = {
  id: string;
  imageType: "photo" | "drawing";
  storagePath: string;
  fileName: string;
  description: string;
  uploadedAt: string;
  uploadedByEmail: string;
  lat: number | null;
  lng: number | null;
  // "sales" = carried over from the Sales Quote on conversion; "project" =
  // added since. Drives the Sales/Project grouping in the photo gallery.
  // Optional (not undefined at runtime -- mapProjectLocationImageRow always
  // sets it) purely so this stays assignable to the shared LocationImageLike
  // shape used by Sales Quote images, which never have this field.
  origin?: "sales" | "project";
};

export type ProjectLocationItem = {
  id: string;
  projectLocationId: string;
  lineType: "sign" | "sensor" | "misc" | "camera" | "vpu";
  catalogItemId: string | null;
  qty: number;
  lineSort: number;
  locationLabel: string;
  accessoryCatalogItemId: string | null;
  accessoryQty: number;
};

export type ProjectLocation = {
  id: string;
  projectId: string;
  locationType: "garage" | "lot";
  name: string;
  // Migration 074: this garage/lot's own physical address -- separate from
  // the project-level Client Address (ProjectSite.address) and the saved
  // Shipping Address book (ProjectSite.shippingAddresses), since a project
  // can span multiple sites that aren't all at the same address.
  address: string;
  lineSort: number;
  fli: boolean;
  lpr: boolean;
  peopleCounting: boolean;
  fliCameraItemId: string | null;
  lprCameraItemId: string | null;
  peopleCountingCameraItemId: string | null;
  entriesCount: number;
  exitsCount: number;
  levelsCount: number;
  sourceQuoteLocationId: string | null;
  images: ProjectLocationImage[];
  signLines: ProjectLocationItem[];
  sensorLines: ProjectLocationItem[];
  miscLines: ProjectLocationItem[];
  cameraLines: ProjectLocationItem[];
  vpuLines: ProjectLocationItem[];
};

export type ProjectSite = {
  // Real projects.id (uuid) -- optional/absent for the many hardcoded/demo
  // ProjectSite objects sprinkled around this file that predate the real
  // backend cutover; only needed for the Locations feature
  // (project_locations FKs to this, not to the name/ref).
  id?: string;
  ref: string;
  name: string;
  client: string;
  clientId?: string;
  type: "Parking Garage" | "Surface Lot" | "Campus Parking" | "Mixed Parking";
  address: string;
  owner: string;
  status: "Draft" | "Planning" | "Procurement" | "Staging" | "Install Ready" | "Closed";
  due: string;
  package: string;
  cameras: number;
  allocated: number;
  siteNotes: string;
  salesQuoteFile?: string;
  sow: ScopeOfWork;
  bom: BomLine[];
  locations?: ProjectLocation[];
  shippingAddresses?: ProjectShippingAddress[];
  shipments?: ProjectShipment[];
  // Migration 073: pulled from the Sales Quote's saas* fields when the
  // project is created from a Closed - Won quote. saasStartDate gets
  // stamped automatically the first time status becomes "Closed" --
  // that's the actual contract start, not when the quote was signed.
  // Optional for the same reason locations/shipments are -- the many
  // hardcoded/demo ProjectSite objects elsewhere in this file predate
  // this and don't set it.
  saasType?: string;
  saasContractAmount?: number | null;
  saasBillingFrequency?: "Monthly" | "Quarterly" | "Annual" | "";
  saasStartDate?: string;
  saasRenewalDate?: string;
  // Migration 076: Cost Breakdown / Cost Snapshot. saleAmount defaults from
  // the originating Sales Quote's saleAmount on conversion, then stays
  // independently editable here -- a PM may need to correct it post-close.
  // The other three are PM-entered, dollar amounts (not hours x rate).
  saleAmount?: number | null;
  estimatedLaborCost?: number | null;
  subcontractorCost?: number | null;
  travelExpenses?: number | null;
  // Migration 077: single field, per E ("doesn't usually change per-
  // shipment the way a delivery address does") -- not a saved list like
  // shippingAddresses.
  billingAddress?: string;
  // Migration 078: Address Book redesign -- every address (Client, Billing,
  // and each Shipping entry) gets the same complete card: Name(s), Address,
  // Home/Cell/Work/Office phone. "Same as Client" in the UI is a one-time
  // copy-in, not a persisted link -- these stay independently editable.
  clientHomePhone?: string;
  clientCellPhone?: string;
  clientWorkPhone?: string;
  clientOfficePhone?: string;
  billingName?: string;
  billingHomePhone?: string;
  billingCellPhone?: string;
  billingWorkPhone?: string;
  billingOfficePhone?: string;
};

// Migration 072: PM shipping requests, fulfilled by Warehouse/
// Implementation -- Requested -> Packed (photos) -> Shipped (carrier +
// tracking), or Cancelled. Lines key by item_name, same convention as the
// rest of the BOM system (BomLine has no stable id).
export type ProjectShippingAddress = {
  id: string;
  projectId: string;
  label: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
  // Migration 078: Address Book redesign -- attnName is shown as "Name(s)"
  // and phone as "Office" in the tight-card UI (same columns, just relabeled
  // so the field set matches Client/Billing's Name(s)/Home/Cell/Work/Office).
  attnName: string;
  phone: string;
  homePhone: string;
  cellPhone: string;
  workPhone: string;
  lineSort: number;
};

export type ProjectShipmentLine = {
  id: string;
  shipmentId: string;
  itemName: string;
  qty: number;
  lineSort: number;
};

export type ProjectShipmentPhoto = {
  id: string;
  shipmentId: string;
  storagePath: string;
  fileName: string;
  description: string;
  uploadedAt: string;
  uploadedByEmail: string;
};

export type ProjectShipment = {
  id: string;
  projectId: string;
  shipmentNumber: string;
  addressId: string | null;
  addressSnapshot: string;
  status: "Requested" | "Packed" | "Shipped" | "Cancelled";
  requestedByEmail: string;
  requestedAt: string;
  notes: string;
  packedByEmail: string | null;
  packedAt: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  shippedByEmail: string | null;
  shippedAt: string | null;
  lines: ProjectShipmentLine[];
  photos: ProjectShipmentPhoto[];
};

const EMPTY_SCOPE_OF_WORK: ScopeOfWork = {
  summary: "",
  preparation: "",
  infrastructure: "",
  installation: "",
  commissioning: "",
  fineTuning: "",
  assumptions: "",
  exclusions: "",
};

type ProjectScopeRow = {
  summary: string;
  preparation: string;
  infrastructure: string;
  installation: string;
  commissioning: string;
  fine_tuning: string;
  assumptions: string;
  exclusions: string;
};

type ProjectBomLineRow = {
  id: string;
  item_name: string;
  qty: number | string;
  status: string;
  request_speed: string;
  po: string | null;
  notes: string | null;
  line_sort: number;
  procurement_track: string | null;
  purchasing_sent_at: string | null;
  ship_to: string | null;
  inventory_item: { sku: string } | null;
};

type ProjectLocationImageRow = {
  id: string;
  image_type: string;
  storage_path: string;
  file_name: string | null;
  description: string | null;
  uploaded_at: string;
  uploaded_by_email: string | null;
  photo_lat: number | string | null;
  photo_lng: number | string | null;
  origin: string | null;
};

type ProjectLocationItemRow = {
  id: string;
  project_location_id: string;
  line_type: string;
  catalog_item_id: string | null;
  qty: number | string;
  line_sort: number;
  location_label: string | null;
  accessory_catalog_item_id: string | null;
  accessory_qty: number | string;
};

type ProjectLocationRow = {
  id: string;
  project_id: string;
  location_type: string;
  name: string;
  address: string | null;
  line_sort: number;
  fli: boolean;
  lpr: boolean;
  people_counting: boolean;
  fli_camera_item_id: string | null;
  lpr_camera_item_id: string | null;
  people_counting_camera_item_id: string | null;
  entries_count: number | string;
  exits_count: number | string;
  levels_count: number | string;
  source_quote_location_id: string | null;
  project_location_images: ProjectLocationImageRow[];
  project_location_items: ProjectLocationItemRow[];
};

function mapProjectLocationImageRow(row: ProjectLocationImageRow): ProjectLocationImage {
  return {
    id: row.id,
    imageType: row.image_type === "drawing" ? "drawing" : "photo",
    storagePath: row.storage_path,
    fileName: row.file_name ?? "",
    description: row.description ?? "",
    uploadedAt: row.uploaded_at,
    uploadedByEmail: row.uploaded_by_email ?? "",
    lat: row.photo_lat === null || row.photo_lat === undefined ? null : Number(row.photo_lat),
    lng: row.photo_lng === null || row.photo_lng === undefined ? null : Number(row.photo_lng),
    origin: row.origin === "sales" ? "sales" : "project",
  };
}

function mapProjectLocationItemRow(row: ProjectLocationItemRow): ProjectLocationItem {
  return {
    id: row.id,
    projectLocationId: row.project_location_id,
    lineType: row.line_type as ProjectLocationItem["lineType"],
    catalogItemId: row.catalog_item_id ?? null,
    qty: Number(row.qty) || 0,
    lineSort: row.line_sort,
    locationLabel: row.location_label ?? "",
    accessoryCatalogItemId: row.accessory_catalog_item_id ?? null,
    accessoryQty: Number(row.accessory_qty) || 0,
  };
}

function mapProjectLocationRow(row: ProjectLocationRow): ProjectLocation {
  const items = (row.project_location_items ?? []).map(mapProjectLocationItemRow).sort((a, b) => a.lineSort - b.lineSort);
  return {
    id: row.id,
    projectId: row.project_id,
    locationType: row.location_type === "lot" ? "lot" : "garage",
    name: row.name,
    address: row.address ?? "",
    lineSort: row.line_sort,
    fli: row.fli,
    lpr: row.lpr,
    peopleCounting: row.people_counting,
    fliCameraItemId: row.fli_camera_item_id ?? null,
    lprCameraItemId: row.lpr_camera_item_id ?? null,
    peopleCountingCameraItemId: row.people_counting_camera_item_id ?? null,
    entriesCount: Number(row.entries_count) || 0,
    exitsCount: Number(row.exits_count) || 0,
    levelsCount: Number(row.levels_count) || 0,
    sourceQuoteLocationId: row.source_quote_location_id ?? null,
    images: (row.project_location_images ?? []).map(mapProjectLocationImageRow),
    signLines: items.filter((item) => item.lineType === "sign"),
    sensorLines: items.filter((item) => item.lineType === "sensor"),
    miscLines: items.filter((item) => item.lineType === "misc"),
    cameraLines: items.filter((item) => item.lineType === "camera"),
    vpuLines: items.filter((item) => item.lineType === "vpu"),
  };
}

const PROJECT_LOCATION_SELECT =
  "id,project_id,location_type,name,address,line_sort,fli,lpr,people_counting,fli_camera_item_id,lpr_camera_item_id,people_counting_camera_item_id,entries_count,exits_count,levels_count,source_quote_location_id,project_location_images(id,image_type,storage_path,file_name,description,uploaded_at,uploaded_by_email,photo_lat,photo_lng,origin),project_location_items(id,project_location_id,line_type,catalog_item_id,qty,line_sort,location_label,accessory_catalog_item_id,accessory_qty)";
// Migration 087 safety: same shape minus `origin`, in case that column
// hasn't landed yet -- without this, the whole Projects list 400s instead
// of just missing the Sales/Project photo grouping.
const PROJECT_LOCATION_SELECT_PRE_087 =
  "id,project_id,location_type,name,address,line_sort,fli,lpr,people_counting,fli_camera_item_id,lpr_camera_item_id,people_counting_camera_item_id,entries_count,exits_count,levels_count,source_quote_location_id,project_location_images(id,image_type,storage_path,file_name,description,uploaded_at,uploaded_by_email,photo_lat,photo_lng),project_location_items(id,project_location_id,line_type,catalog_item_id,qty,line_sort,location_label,accessory_catalog_item_id,accessory_qty)";

type ProjectShippingAddressRow = {
  id: string;
  project_id: string;
  label: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  attn_name: string | null;
  phone: string | null;
  home_phone: string | null;
  cell_phone: string | null;
  work_phone: string | null;
  line_sort: number;
};

function mapProjectShippingAddressRow(row: ProjectShippingAddressRow): ProjectShippingAddress {
  return {
    id: row.id,
    projectId: row.project_id,
    label: row.label ?? "",
    streetAddress: row.street_address ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    zip: row.zip ?? "",
    attnName: row.attn_name ?? "",
    phone: row.phone ?? "",
    homePhone: row.home_phone ?? "",
    cellPhone: row.cell_phone ?? "",
    workPhone: row.work_phone ?? "",
    lineSort: row.line_sort,
  };
}

const PROJECT_SHIPPING_ADDRESS_SELECT = "id,project_id,label,street_address,city,state,zip,attn_name,phone,home_phone,cell_phone,work_phone,line_sort";

type ProjectShipmentLineRow = {
  id: string;
  shipment_id: string;
  item_name: string;
  qty: number | string;
  line_sort: number;
};

function mapProjectShipmentLineRow(row: ProjectShipmentLineRow): ProjectShipmentLine {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    itemName: row.item_name,
    qty: Number(row.qty) || 0,
    lineSort: row.line_sort,
  };
}

type ProjectShipmentPhotoRow = {
  id: string;
  shipment_id: string;
  storage_path: string;
  file_name: string | null;
  description: string | null;
  uploaded_at: string;
  uploaded_by_email: string | null;
};

function mapProjectShipmentPhotoRow(row: ProjectShipmentPhotoRow): ProjectShipmentPhoto {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    storagePath: row.storage_path,
    fileName: row.file_name ?? "",
    description: row.description ?? "",
    uploadedAt: row.uploaded_at,
    uploadedByEmail: row.uploaded_by_email ?? "",
  };
}

type ProjectShipmentRow = {
  id: string;
  project_id: string;
  shipment_number: string;
  address_id: string | null;
  address_snapshot: string | null;
  status: string;
  requested_by_email: string | null;
  requested_at: string;
  notes: string | null;
  packed_by_email: string | null;
  packed_at: string | null;
  carrier: string | null;
  tracking_number: string | null;
  shipped_by_email: string | null;
  shipped_at: string | null;
  project_shipment_lines: ProjectShipmentLineRow[] | null;
  project_shipment_photos: ProjectShipmentPhotoRow[] | null;
};

function mapProjectShipmentRow(row: ProjectShipmentRow): ProjectShipment {
  return {
    id: row.id,
    projectId: row.project_id,
    shipmentNumber: row.shipment_number,
    addressId: row.address_id,
    addressSnapshot: row.address_snapshot ?? "",
    status: (row.status as ProjectShipment["status"]) ?? "Requested",
    requestedByEmail: row.requested_by_email ?? "",
    requestedAt: row.requested_at,
    notes: row.notes ?? "",
    packedByEmail: row.packed_by_email,
    packedAt: row.packed_at,
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    shippedByEmail: row.shipped_by_email,
    shippedAt: row.shipped_at,
    lines: (row.project_shipment_lines ?? []).map(mapProjectShipmentLineRow).sort((a, b) => a.lineSort - b.lineSort),
    photos: (row.project_shipment_photos ?? []).map(mapProjectShipmentPhotoRow),
  };
}

const PROJECT_SHIPMENT_SELECT =
  "id,project_id,shipment_number,address_id,address_snapshot,status,requested_by_email,requested_at,notes,packed_by_email,packed_at,carrier,tracking_number,shipped_by_email,shipped_at,project_shipment_lines(id,shipment_id,item_name,qty,line_sort),project_shipment_photos(id,shipment_id,storage_path,file_name,description,uploaded_at,uploaded_by_email)";

type ProjectSiteRow = {
  id: string;
  project_name: string;
  project_number: string | null;
  customer_name: string | null;
  client_id: string | null;
  site_type: string | null;
  site_address: string | null;
  owner_name: string | null;
  app_status: string | null;
  target_date_display: string | null;
  solution_package: string | null;
  camera_count: number | string | null;
  allocated_amount: number | string | null;
  sales_quote_file: string | null;
  notes: string | null;
  project_scope_of_work: ProjectScopeRow | ProjectScopeRow[] | null;
  project_bom_lines: ProjectBomLineRow[] | null;
  project_locations: ProjectLocationRow[] | null;
  project_shipping_addresses: ProjectShippingAddressRow[] | null;
  project_shipments: ProjectShipmentRow[] | null;
  saas_type: string | null;
  saas_contract_amount: number | string | null;
  saas_billing_frequency: string | null;
  saas_start_date: string | null;
  saas_renewal_date: string | null;
  sale_amount: number | string | null;
  estimated_labor_cost: number | string | null;
  subcontractor_cost: number | string | null;
  travel_expenses: number | string | null;
  billing_address: string | null;
  client_home_phone: string | null;
  client_cell_phone: string | null;
  client_work_phone: string | null;
  client_office_phone: string | null;
  billing_name: string | null;
  billing_home_phone: string | null;
  billing_cell_phone: string | null;
  billing_work_phone: string | null;
  billing_office_phone: string | null;
};

const PROJECT_SITE_SELECT =
  `id,project_name,project_number,customer_name,client_id,site_type,site_address,owner_name,app_status,target_date_display,solution_package,camera_count,allocated_amount,sales_quote_file,notes,saas_type,saas_contract_amount,saas_billing_frequency,saas_start_date,saas_renewal_date,sale_amount,estimated_labor_cost,subcontractor_cost,travel_expenses,billing_address,client_home_phone,client_cell_phone,client_work_phone,client_office_phone,billing_name,billing_home_phone,billing_cell_phone,billing_work_phone,billing_office_phone,project_scope_of_work(summary,preparation,infrastructure,installation,commissioning,fine_tuning,assumptions,exclusions),project_bom_lines(id,item_name,qty,status,request_speed,po,notes,line_sort,procurement_track,purchasing_sent_at,ship_to,inventory_item:inventory_items(sku)),project_locations(${PROJECT_LOCATION_SELECT}),project_shipping_addresses(${PROJECT_SHIPPING_ADDRESS_SELECT}),project_shipments(${PROJECT_SHIPMENT_SELECT})`;
// Migration 087 safety: same query with the pre-087 (no `origin`) location
// select, used as a 400 fallback in loadProjectSites.
const PROJECT_SITE_SELECT_PRE_087 =
  `id,project_name,project_number,customer_name,client_id,site_type,site_address,owner_name,app_status,target_date_display,solution_package,camera_count,allocated_amount,sales_quote_file,notes,saas_type,saas_contract_amount,saas_billing_frequency,saas_start_date,saas_renewal_date,sale_amount,estimated_labor_cost,subcontractor_cost,travel_expenses,billing_address,client_home_phone,client_cell_phone,client_work_phone,client_office_phone,billing_name,billing_home_phone,billing_cell_phone,billing_work_phone,billing_office_phone,project_scope_of_work(summary,preparation,infrastructure,installation,commissioning,fine_tuning,assumptions,exclusions),project_bom_lines(id,item_name,qty,status,request_speed,po,notes,line_sort,procurement_track,purchasing_sent_at,ship_to,inventory_item:inventory_items(sku)),project_locations(${PROJECT_LOCATION_SELECT_PRE_087}),project_shipping_addresses(${PROJECT_SHIPPING_ADDRESS_SELECT}),project_shipments(${PROJECT_SHIPMENT_SELECT})`;

function mapProjectSiteRow(row: ProjectSiteRow): ProjectSite {
  const scopeRaw = Array.isArray(row.project_scope_of_work) ? row.project_scope_of_work[0] : row.project_scope_of_work;
  const sow: ScopeOfWork = scopeRaw
    ? {
        summary: scopeRaw.summary ?? "",
        preparation: scopeRaw.preparation ?? "",
        infrastructure: scopeRaw.infrastructure ?? "",
        installation: scopeRaw.installation ?? "",
        commissioning: scopeRaw.commissioning ?? "",
        fineTuning: scopeRaw.fine_tuning ?? "",
        assumptions: scopeRaw.assumptions ?? "",
        exclusions: scopeRaw.exclusions ?? "",
      }
    : { ...EMPTY_SCOPE_OF_WORK };
  const bom: BomLine[] = (row.project_bom_lines ?? [])
    .slice()
    .sort((a, b) => a.line_sort - b.line_sort)
    .map((line) => ({
      clientId: line.id,
      id: line.id,
      sku: line.inventory_item?.sku ?? undefined,
      item: line.item_name,
      qty: Number(line.qty) || 0,
      status: (line.status as BomLine["status"]) ?? "Not started",
      requestSpeed: (line.request_speed as BomLine["requestSpeed"]) ?? "Standard",
      po: line.po ?? undefined,
      notes: line.notes ?? undefined,
      procurementTrack: (line.procurement_track as BomLine["procurementTrack"]) ?? "warehouse_stock",
      sentToPurchasingAt: line.purchasing_sent_at ?? null,
      shipTo: line.ship_to ?? "",
    }));
  return {
    id: row.id,
    ref: row.project_number ?? "",
    name: row.project_name,
    client: row.customer_name ?? "",
    clientId: row.client_id ?? undefined,
    type: (row.site_type as ProjectSite["type"]) ?? "Parking Garage",
    address: row.site_address ?? "",
    owner: row.owner_name ?? "",
    status: (row.app_status as ProjectSite["status"]) ?? "Draft",
    due: row.target_date_display ?? "",
    package: row.solution_package ?? "",
    cameras: Number(row.camera_count) || 0,
    allocated: Number(row.allocated_amount) || 0,
    siteNotes: row.notes ?? "",
    salesQuoteFile: row.sales_quote_file ?? undefined,
    sow,
    bom,
    locations: (row.project_locations ?? []).map(mapProjectLocationRow).sort((a, b) => a.lineSort - b.lineSort),
    shippingAddresses: (row.project_shipping_addresses ?? []).map(mapProjectShippingAddressRow).sort((a, b) => a.lineSort - b.lineSort),
    shipments: (row.project_shipments ?? []).map(mapProjectShipmentRow).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
    saasType: row.saas_type ?? "",
    saasContractAmount: row.saas_contract_amount === null || row.saas_contract_amount === undefined ? null : Number(row.saas_contract_amount),
    saasBillingFrequency: (row.saas_billing_frequency as ProjectSite["saasBillingFrequency"]) ?? "",
    saasStartDate: row.saas_start_date ?? "",
    saasRenewalDate: row.saas_renewal_date ?? "",
    saleAmount: row.sale_amount === null || row.sale_amount === undefined ? null : Number(row.sale_amount),
    estimatedLaborCost: row.estimated_labor_cost === null || row.estimated_labor_cost === undefined ? null : Number(row.estimated_labor_cost),
    subcontractorCost: row.subcontractor_cost === null || row.subcontractor_cost === undefined ? null : Number(row.subcontractor_cost),
    travelExpenses: row.travel_expenses === null || row.travel_expenses === undefined ? null : Number(row.travel_expenses),
    billingAddress: row.billing_address ?? "",
    clientHomePhone: row.client_home_phone ?? "",
    clientCellPhone: row.client_cell_phone ?? "",
    clientWorkPhone: row.client_work_phone ?? "",
    clientOfficePhone: row.client_office_phone ?? "",
    billingName: row.billing_name ?? "",
    billingHomePhone: row.billing_home_phone ?? "",
    billingCellPhone: row.billing_cell_phone ?? "",
    billingWorkPhone: row.billing_work_phone ?? "",
    billingOfficePhone: row.billing_office_phone ?? "",
  };
}

// Migration 088: soft-deleted locations/items/images shouldn't show up in
// the normal app -- filtered out here via embedded PostgREST filters
// rather than dropped from the select, so `fetchWithDeletedAtFallback` can
// strip just these params (and nothing else) if 088 hasn't run yet.
const PROJECT_LOCATIONS_DELETED_AT_FILTERS =
  "&project_locations.deleted_at=is.null&project_locations.project_location_images.deleted_at=is.null&project_locations.project_location_items.deleted_at=is.null&project_shipments.project_shipment_photos.deleted_at=is.null";

export async function loadProjectSites(accessToken?: string): Promise<ProjectSite[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetchWithDeletedAtFallback(
    supabaseUrl(`projects?select=${PROJECT_SITE_SELECT}&order=project_name.asc${PROJECT_LOCATIONS_DELETED_AT_FILTERS}`),
    supabaseHeaders(accessToken),
  );
  if (!response.ok && response.status === 400) {
    const fallbackResponse = await fetchWithDeletedAtFallback(
      supabaseUrl(`projects?select=${PROJECT_SITE_SELECT_PRE_087}&order=project_name.asc${PROJECT_LOCATIONS_DELETED_AT_FILTERS}`),
      supabaseHeaders(accessToken),
    );
    if (!fallbackResponse.ok) {
      return [];
    }
    const fallbackRows = (await fallbackResponse.json()) as ProjectSiteRow[];
    return fallbackRows.map(mapProjectSiteRow);
  }
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as ProjectSiteRow[];
  return rows.map(mapProjectSiteRow);
}

export async function saveProjectSites(sites: ProjectSite[], accessToken?: string): Promise<ProjectSite[]> {
  if (!isRemotePersistenceConfigured() || !accessToken || sites.length === 0) {
    return sites;
  }

  const projectPayload = sites.map((site) => ({
    project_name: site.name,
    project_number: site.ref || null,
    customer_name: site.client || null,
    site_type: site.type,
    site_address: site.address || null,
    owner_name: site.owner || null,
    app_status: site.status,
    target_date: /^\d{4}-\d{2}-\d{2}$/.test(site.due) ? site.due : null,
    target_date_display: site.due || null,
    solution_package: site.package || null,
    camera_count: site.cameras,
    allocated_amount: site.allocated,
    sales_quote_file: site.salesQuoteFile || null,
    notes: site.siteNotes,
    saas_type: site.saasType || null,
    saas_contract_amount: site.saasContractAmount,
    saas_billing_frequency: site.saasBillingFrequency || null,
    saas_start_date: site.saasStartDate || null,
    saas_renewal_date: site.saasRenewalDate || null,
    sale_amount: site.saleAmount ?? null,
    estimated_labor_cost: site.estimatedLaborCost ?? null,
    subcontractor_cost: site.subcontractorCost ?? null,
    travel_expenses: site.travelExpenses ?? null,
    billing_address: site.billingAddress || null,
    client_home_phone: site.clientHomePhone || null,
    client_cell_phone: site.clientCellPhone || null,
    client_work_phone: site.clientWorkPhone || null,
    client_office_phone: site.clientOfficePhone || null,
    billing_name: site.billingName || null,
    billing_home_phone: site.billingHomePhone || null,
    billing_cell_phone: site.billingCellPhone || null,
    billing_work_phone: site.billingWorkPhone || null,
    billing_office_phone: site.billingOfficePhone || null,
  }));

  const projectResponse = await fetch(supabaseUrl("projects?on_conflict=project_name"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(projectPayload),
  });
  if (!projectResponse.ok) {
    const bodyText = await projectResponse.text().catch(() => "");
    console.error(`saveProjectSites: projects write failed (${projectResponse.status}): ${bodyText}`);
    throw new Error(`Could not save projects: ${projectResponse.status}`);
  }
  const savedRows = (await projectResponse.json()) as Array<{ id: string; project_name: string }>;
  // Reviewed 2026-09-12 (overnight reliability closeout, task 5): added
  // for consistency with every other upsert in this file -- a single
  // `INSERT ... ON CONFLICT` statement fails atomically as one unit, so
  // this is a coverage gap being closed, not a confirmed partial-write bug
  // (unlike the BOM lines' former delete-then-reinsert, which really could
  // leave a project's BOM silently empty -- see migration 131).
  if (savedRows.length !== sites.length) {
    console.error(`saveProjectSites: projects write returned ${savedRows.length} row(s), expected ${sites.length} -- integrity check failed.`);
    throw new Error("Some project changes could not be saved.");
  }
  const idByName = new Map(savedRows.map((row) => [row.project_name, row.id]));

  const scopePayload = sites
    .map((site) => {
      const projectId = idByName.get(site.name);
      return projectId
        ? {
            project_id: projectId,
            summary: site.sow.summary,
            preparation: site.sow.preparation,
            infrastructure: site.sow.infrastructure,
            installation: site.sow.installation,
            commissioning: site.sow.commissioning,
            fine_tuning: site.sow.fineTuning,
            assumptions: site.sow.assumptions,
            exclusions: site.sow.exclusions,
          }
        : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (scopePayload.length > 0) {
    const scopeResponse = await fetch(supabaseUrl("project_scope_of_work?on_conflict=project_id"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(scopePayload),
    });
    if (!scopeResponse.ok) {
      const bodyText = await scopeResponse.text().catch(() => "");
      console.error(`saveProjectSites: project_scope_of_work write failed (${scopeResponse.status}): ${bodyText}`);
      throw new Error("Some project details could not be saved.");
    }
    // This write was previously never checked at all -- a 200/204 with a
    // row count that doesn't exactly match what was sent (fewer or more)
    // means a project's summary/preparation/infrastructure/installation/
    // commissioning/fine-tuning/assumptions/exclusions text silently
    // didn't persist as intended, while the project record itself
    // (checked above) looked saved fine. The real status/count detail is
    // logged for diagnosis; the user only ever sees a plain statement.
    const savedScopeRows = (await scopeResponse.json().catch(() => [])) as unknown[];
    if (savedScopeRows.length !== scopePayload.length) {
      console.error(
        `saveProjectSites: project_scope_of_work write returned ${savedScopeRows.length} row(s), expected ${scopePayload.length} -- integrity check failed.`,
      );
      throw new Error("Some project details could not be saved.");
    }
  }

  // Migration 131 moved BOM-line replacement from two separate, completely
  // unchecked PostgREST requests (a bulk DELETE of every existing line for
  // the project, then a bulk INSERT of the current line set, with no
  // transaction between them and no id preservation across a save) into
  // one atomic, per-project RPC call (rpc/replace_project_bom_lines):
  // reconciliation (update retained lines in place, insert new ones,
  // delete only removed ones), item-identity validation, and the
  // ambiguous-name rejection all happen inside a single Postgres
  // transaction now, and a project's BOM can no longer be left silently
  // empty by a DELETE that committed with no matching INSERT.
  //
  // A brand-new line (no `id` yet) is sent with `id: null`, and the RPC
  // always inserts it as new -- unlike an equipment recipe's name-based
  // fallback resolution, a BOM line has no natural key to fall back to, so
  // this function backfills each returned line's real id into the
  // returned sites. createProjectSiteSaveQueue serializes overlapping saves
  // and reconcileSavedProjectSites matches the result through each line's
  // stable clientId, so a still-new line is sent with id:null only once and
  // edits made while that request is in flight are not overwritten.
  const reconciledSites: ProjectSite[] = [];
  for (const site of sites) {
    const projectId = idByName.get(site.name);
    if (!projectId) {
      reconciledSites.push(site);
      continue;
    }

    const response = await fetch(supabaseUrl("rpc/replace_project_bom_lines"), {
      method: "POST",
      headers: supabaseHeaders(accessToken),
      body: JSON.stringify({
        p_project_id: projectId,
        p_lines: site.bom.map((line, index) => ({
          id: line.id ?? null,
          item_name: line.item,
          sku: line.sku ?? null,
          qty: line.qty,
          status: line.status,
          request_speed: line.requestSpeed,
          po: line.po || null,
          notes: line.notes || null,
          procurement_track: line.procurementTrack ?? "warehouse_stock",
          purchasing_sent_at: line.sentToPurchasingAt ?? null,
          ship_to: line.shipTo || null,
          line_sort: index,
        })),
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
      console.error(`saveProjectSites: replace_project_bom_lines RPC failed for "${site.name}" (${response.status}):`, body);
      throw new Error("Some project BOM changes could not be saved.");
    }
    const raw = (await response.json()) as { lines: Array<{ id: string; item: string; sku: string | null; qty: number; status: string; requestSpeed: string; po: string | null; notes: string | null; procurementTrack: string; sentToPurchasingAt: string | null; shipTo: string | null }> };
    reconciledSites.push({
      ...site,
      bom: raw.lines.map((line) => ({
        id: line.id,
        sku: line.sku ?? undefined,
        item: line.item,
        qty: Number(line.qty) || 0,
        status: line.status as BomLine["status"],
        requestSpeed: line.requestSpeed as BomLine["requestSpeed"],
        po: line.po ?? undefined,
        notes: line.notes ?? undefined,
        procurementTrack: line.procurementTrack as BomLine["procurementTrack"],
        sentToPurchasingAt: line.sentToPurchasingAt,
        shipTo: line.shipTo ?? "",
      })),
    });
  }

  return reconciledSites;
}

// Backfill only the stable database identifiers returned by migration 131.
// Project and line display fields may have changed while the request was in
// flight, so they are deliberately never copied back from the server echo.
export function reconcileSavedProjectSites(
  current: ProjectSite[],
  requested: ProjectSite[],
  saved: ProjectSite[],
): ProjectSite[] {
  const siteBackfills = new Map<string, Map<string, Pick<BomLine, "id" | "sku">>>();
  requested.forEach((site, siteIndex) => {
    const siteKey = site.id ?? site.ref ?? site.name;
    const savedSite = saved[siteIndex];
    if (!savedSite) return;
    const lineBackfills = new Map<string, Pick<BomLine, "id" | "sku">>();
    site.bom.forEach((line, lineIndex) => {
      const lineKey = line.clientId ?? line.id;
      const savedLine = savedSite.bom[lineIndex];
      if (lineKey && savedLine?.id) {
        lineBackfills.set(lineKey, { id: savedLine.id, sku: savedLine.sku });
      }
    });
    if (lineBackfills.size > 0) siteBackfills.set(siteKey, lineBackfills);
  });
  if (siteBackfills.size === 0) return current;

  let changed = false;
  const next = current.map((site) => {
    const lineBackfills = siteBackfills.get(site.id ?? site.ref ?? site.name);
    if (!lineBackfills) return site;
    let siteChanged = false;
    const bom = site.bom.map((line) => {
      const backfill = lineBackfills.get(line.clientId ?? line.id ?? "");
      if (!backfill || (line.id === backfill.id && line.sku === backfill.sku)) return line;
      siteChanged = true;
      return { ...line, id: backfill.id, sku: backfill.sku };
    });
    if (!siteChanged) return site;
    changed = true;
    return { ...site, bom };
  });
  return changed ? next : current;
}

export function createProjectSiteSaveQueue(
  applyReconciled: (updater: (current: ProjectSite[]) => ProjectSite[]) => void,
  onError: (error: unknown) => void,
) {
  let saving = false;
  let pending: { sites: ProjectSite[]; accessToken: string } | null = null;

  async function run(sites: ProjectSite[], accessToken: string): Promise<void> {
    saving = true;
    let saved: ProjectSite[] | null = null;
    try {
      saved = await saveProjectSites(sites, accessToken);
      applyReconciled((current) => reconcileSavedProjectSites(current, sites, saved!));
    } catch (error) {
      onError(error);
    } finally {
      saving = false;
    }
    const next = pending;
    pending = null;
    if (next) {
      const followUp = saved ? reconcileSavedProjectSites(next.sites, sites, saved) : next.sites;
      void run(followUp, next.accessToken);
    }
  }

  return {
    enqueue(sites: ProjectSite[], accessToken: string): void {
      if (saving) {
        pending = { sites, accessToken };
        return;
      }
      void run(sites, accessToken);
    },
  };
}

// --- Client Ledger (migration 089) -----------------------------------------
// E: "Need an additional Tab up top for when we close out a project, we
// need the information to go somewhere for future" -- a permanent per-site
// record covering Active/Archived sites, Financial Summary, SaaS info
// (already existed, just surfaced here), a Hardware/EOL tracker (genuinely
// new -- nothing else in the app tracks a serialized physical unit with an
// install date), and a Closeout Vault of final documents.
//
// kickoff_date/warranty_expiration_date deliberately live OUTSIDE
// PROJECT_SITE_SELECT/ProjectSite -- that select is the app's biggest,
// most-loaded query (every page needs projectSites), and these two fields
// are only ever read/written from the Client Ledger tab. Keeping them on a
// separate, lazily-loaded fetch means if migration 089 hasn't run yet, only
// this one tab is affected -- not the whole app going blank the way adding
// them to PROJECT_SITE_SELECT directly would risk.

export type ProjectLedgerInfo = {
  projectId: string;
  kickoffDate: string;
  warrantyExpirationDate: string;
  // Migration 090: closing a project (PM sets status to Closed) does NOT
  // by itself put it in the Client Ledger's Primary List -- it just makes
  // it eligible, sitting in the "Closed Projects" queue until someone
  // deliberately moves it. addedToLedger flips true only at that point.
  // ledgerBucket ("active" = ongoing SaaS/support relationship, "archived"
  // = fully wrapped up) is a manual choice made at that same moment,
  // independent of the project's own status field.
  addedToLedger: boolean;
  ledgerBucket: "active" | "archived" | null;
};

type ProjectLedgerInfoRow = {
  id: string;
  kickoff_date: string | null;
  warranty_expiration_date: string | null;
  added_to_ledger: boolean | null;
  ledger_bucket: string | null;
};

export async function loadProjectLedgerInfo(accessToken?: string): Promise<ProjectLedgerInfo[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl("projects?select=id,kickoff_date,warranty_expiration_date,added_to_ledger,ledger_bucket"), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as ProjectLedgerInfoRow[];
  return rows.map((row) => ({
    projectId: row.id,
    kickoffDate: row.kickoff_date ?? "",
    warrantyExpirationDate: row.warranty_expiration_date ?? "",
    addedToLedger: Boolean(row.added_to_ledger),
    ledgerBucket: row.ledger_bucket === "active" || row.ledger_bucket === "archived" ? row.ledger_bucket : null,
  }));
}

export async function updateProjectLedgerInfo(
  projectId: string,
  updates: Partial<{ kickoffDate: string; warrantyExpirationDate: string; addedToLedger: boolean; ledgerBucket: "active" | "archived" | null }>,
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (updates.kickoffDate !== undefined) payload.kickoff_date = updates.kickoffDate || null;
  if (updates.warrantyExpirationDate !== undefined) payload.warranty_expiration_date = updates.warrantyExpirationDate || null;
  if (updates.addedToLedger !== undefined) payload.added_to_ledger = updates.addedToLedger;
  if (updates.ledgerBucket !== undefined) payload.ledger_bucket = updates.ledgerBucket;
  if (Object.keys(payload).length === 0) {
    return;
  }
  // Reviewed 2026-09-12 (overnight reliability closeout, task 5):
  // technical diagnostic only, not a behavior change -- a caller-side fix
  // (revert the optimistic Client Ledger update on failure) was attempted
  // 2026-09-11 and reverted after review found the revert-on-failure
  // design concurrency-unsafe (a stale in-flight revert could overwrite a
  // second, later, already-succeeded edit). That redesign is still open
  // and is NOT reattempted here -- this only makes a real PATCH failure
  // visible in the console for diagnosis, matching the same
  // logging-only treatment already used for recordNotificationDelivery/
  // addTaskActivity. The caller's optimistic update is unchanged.
  const response = await fetch(supabaseUrl(`projects?id=eq.${projectId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateProjectLedgerInfo: PATCH failed for project ${projectId} (${response.status}): ${bodyText}`);
  }
}

// Per-unit, serial-level installed hardware -- the genuinely new piece.
// project_location_items only ever tracked a planned QUANTITY of a catalog
// item type per location; this tracks one physical unit with its own
// serial and install date, so an End-of-Life date can be computed
// (install_date + catalog item's expected_lifespan_years).
export type InstalledAsset = {
  id: string;
  projectId: string;
  projectLocationId: string | null;
  catalogItemId: string | null;
  serialNumber: string;
  installDate: string;
  notes: string;
  createdByEmail: string;
  createdAt: string;
};

type InstalledAssetRow = {
  id: string;
  project_id: string;
  project_location_id: string | null;
  catalog_item_id: string | null;
  serial_number: string;
  install_date: string | null;
  notes: string | null;
  created_by_email: string | null;
  created_at: string;
};

function mapInstalledAssetRow(row: InstalledAssetRow): InstalledAsset {
  return {
    id: row.id,
    projectId: row.project_id,
    projectLocationId: row.project_location_id,
    catalogItemId: row.catalog_item_id,
    serialNumber: row.serial_number,
    installDate: row.install_date ?? "",
    notes: row.notes ?? "",
    createdByEmail: row.created_by_email ?? "",
    createdAt: row.created_at,
  };
}

const INSTALLED_ASSET_SELECT = "id,project_id,project_location_id,catalog_item_id,serial_number,install_date,notes,created_by_email,created_at";

export async function loadInstalledAssets(projectId: string, accessToken?: string): Promise<InstalledAsset[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(
    supabaseUrl(`installed_assets?project_id=eq.${projectId}&select=${INSTALLED_ASSET_SELECT}&deleted_at=is.null&order=created_at.desc`),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as InstalledAssetRow[];
  return rows.map(mapInstalledAssetRow);
}

// One catalog item + location + install date, many serials at once -- a
// garage can easily have 50+ sensors, so the add form supports pasting a
// whole list of serials (one per line) rather than one round trip each.
export async function addInstalledAssets(
  projectId: string,
  projectLocationId: string | null,
  catalogItemId: string | null,
  serialNumbers: string[],
  installDate: string,
  notes: string,
  actorEmail: string,
  accessToken?: string,
): Promise<InstalledAsset[]> {
  if (!isRemotePersistenceConfigured() || !accessToken || serialNumbers.length === 0) {
    return [];
  }
  const response = await fetch(supabaseUrl("installed_assets"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify(
      serialNumbers.map((serialNumber) => ({
        project_id: projectId,
        project_location_id: projectLocationId,
        catalog_item_id: catalogItemId,
        serial_number: serialNumber,
        install_date: installDate || null,
        notes: notes || null,
        created_by_email: actorEmail || null,
      })),
    ),
  });
  if (!response.ok) {
    throw new Error(`Could not add asset(s): ${await readSupabaseError(response, "unknown error")}`);
  }
  const rows = (await response.json()) as InstalledAssetRow[];
  return rows.map(mapInstalledAssetRow);
}

export async function updateInstalledAsset(
  id: string,
  updates: Partial<{ installDate: string; notes: string; projectLocationId: string | null }>,
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (updates.installDate !== undefined) payload.install_date = updates.installDate || null;
  if (updates.notes !== undefined) payload.notes = updates.notes || null;
  if (updates.projectLocationId !== undefined) payload.project_location_id = updates.projectLocationId;
  if (Object.keys(payload).length === 0) {
    return;
  }
  await fetch(supabaseUrl(`installed_assets?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
}

export async function deleteInstalledAsset(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`installed_assets?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete installed asset") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("installed_asset", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

// Migration 097: Project Stakeholders -- E: "Good to have a stakeholder
// section including any addresses." Genuinely open-ended roles (property
// owner, GC, electrician, etc.), unlike the Address Book's fixed
// Client/Billing/Shipping cards. Same lazily-loaded, kept-out-of-
// PROJECT_SITE_SELECT shape as installed_assets, for the same reason.
export type ProjectStakeholder = {
  id: string;
  projectId: string;
  role: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  createdByEmail: string;
  createdAt: string;
};

type ProjectStakeholderRow = {
  id: string;
  project_id: string;
  role: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_by_email: string | null;
  created_at: string;
};

function mapProjectStakeholderRow(row: ProjectStakeholderRow): ProjectStakeholder {
  return {
    id: row.id,
    projectId: row.project_id,
    role: row.role,
    name: row.name,
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    notes: row.notes ?? "",
    createdByEmail: row.created_by_email ?? "",
    createdAt: row.created_at,
  };
}

const PROJECT_STAKEHOLDER_SELECT = "id,project_id,role,name,phone,email,address,notes,created_by_email,created_at";

export async function loadProjectStakeholders(projectId: string, accessToken?: string): Promise<ProjectStakeholder[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(
    supabaseUrl(`project_stakeholders?project_id=eq.${projectId}&select=${PROJECT_STAKEHOLDER_SELECT}&deleted_at=is.null&order=created_at.asc`),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as ProjectStakeholderRow[];
  return rows.map(mapProjectStakeholderRow);
}

export async function addProjectStakeholder(
  projectId: string,
  stakeholder: { role: string; name: string; phone: string; email: string; address: string; notes: string },
  actorEmail: string,
  accessToken?: string,
): Promise<ProjectStakeholder | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const response = await fetch(supabaseUrl("project_stakeholders"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      project_id: projectId,
      role: stakeholder.role,
      name: stakeholder.name,
      phone: stakeholder.phone || null,
      email: stakeholder.email || null,
      address: stakeholder.address || null,
      notes: stakeholder.notes || null,
      created_by_email: actorEmail || null,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not add stakeholder: ${await readSupabaseError(response, "unknown error")}`);
  }
  const rows = (await response.json()) as ProjectStakeholderRow[];
  return rows[0] ? mapProjectStakeholderRow(rows[0]) : null;
}

export async function updateProjectStakeholder(
  id: string,
  updates: Partial<{ role: string; name: string; phone: string; email: string; address: string; notes: string }>,
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (updates.role !== undefined) payload.role = updates.role;
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.phone !== undefined) payload.phone = updates.phone || null;
  if (updates.email !== undefined) payload.email = updates.email || null;
  if (updates.address !== undefined) payload.address = updates.address || null;
  if (updates.notes !== undefined) payload.notes = updates.notes || null;
  if (Object.keys(payload).length === 0) {
    return;
  }
  await fetch(supabaseUrl(`project_stakeholders?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
}

export async function deleteProjectStakeholder(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`project_stakeholders?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete stakeholder") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("project_stakeholder", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

export async function loadRemoteAppState(accessToken?: string): Promise<PersistedAppState | null> {
  if (!isRemotePersistenceConfigured()) {
    return null;
  }

  const recordsResponse = await fetch(supabaseUrl(`app_records?workspace_key=eq.${WORKSPACE_KEY}&select=record_key,data`), {
    headers: supabaseHeaders(accessToken),
  });

  if (recordsResponse.ok) {
    const records = (await recordsResponse.json()) as Array<{ record_key: string; data: unknown }>;
    const state = asPersistedState(records);
    if (state) {
      return state;
    }
  } else if (recordsResponse.status !== 404) {
    throw new Error(`Supabase load failed: ${recordsResponse.status}`);
  }

  const response = await fetch(supabaseUrl(`app_state_snapshots?workspace_key=eq.${WORKSPACE_KEY}&select=state&limit=1`), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return null;
  }

  const rows = (await response.json()) as Array<{ state?: PersistedAppState }>;
  return rows[0]?.state ?? null;
}

export async function saveRemoteAppState(state: PersistedAppState, accessToken?: string) {
  if (!isRemotePersistenceConfigured()) {
    return;
  }

  const rows = STATE_KEYS.map((key) => ({
    workspace_key: WORKSPACE_KEY,
    record_key: key,
    data: state[key],
    updated_at: new Date().toISOString(),
  }));

  const response = await fetch(supabaseUrl("app_records?on_conflict=workspace_key,record_key"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    throw new Error(`Supabase save failed: ${response.status}`);
  }

  void fetch(supabaseUrl("app_sync_events"), {
    method: "POST",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({
      workspace_key: WORKSPACE_KEY,
      event_type: "normalized_write",
      entity_type: "app_state",
      entity_ref: WORKSPACE_KEY,
      payload: {
        role_mode: state.roleMode,
      },
    }),
  }).catch(() => {
    // Snapshot save already succeeded; event logging should not block the app.
  });
}

// --- Real full-data backup/restore ------------------------------------------
//
// Export/Import Backup used to just round-trip the app_records blob, which
// meant it only ever covered roleMode once Phase 10 moved everything else
// into real tables -- clicking "Export Backup" produced a JSON file with
// almost nothing in it. This pulls (and restores) every entity from its
// real table instead, so the file is an actual usable snapshot: before a
// risky change, as a recovery point after a mistake, or to seed a second
// (e.g. staging) Supabase project.
//
// Restore is a merge, not a wipe-and-replace: every entity below already has
// an upsert-by-natural-key save function (from the Phase 10 cutover), so
// importing a backup adds/updates rows by their real key (sku, request
// number, project name, etc.) without touching or deleting anything that
// exists now but didn't exist in the backup. That's deliberately the safer
// default -- a destructive "replace everything" mode is a bigger, riskier
// feature and not something to default to silently.

export type FullBackupSnapshot = {
  version: 1;
  exportedAt: string;
  roleMode: string;
  projectSites: ProjectSite[];
  inventoryItems: Part[];
  deviceRecipes: BuildRecipe[];
  purchaseRequests: PurchaseRequest[];
  projectDocuments: ProjectDocument[];
  buildTransactions: BuildTransaction[];
  inventoryMovements: InventoryMovement[];
  projectAllocations: ProjectAllocationHistory[];
};

export async function loadFullBackupSnapshot(roleMode: string, accessToken?: string): Promise<FullBackupSnapshot | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const [projectSites, inventoryItems, deviceRecipes, purchaseRequests, projectDocuments, buildTransactions, inventoryMovements, projectAllocations] =
    await Promise.all([
      loadProjectSites(accessToken),
      loadInventoryItems(accessToken),
      loadDeviceRecipes(accessToken),
      loadPurchaseRequests(accessToken),
      loadProjectDocuments(accessToken),
      loadBuildTransactions(accessToken),
      loadInventoryMovements(accessToken),
      loadProjectAllocations(accessToken),
    ]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    roleMode,
    projectSites,
    inventoryItems,
    deviceRecipes,
    purchaseRequests,
    projectDocuments,
    buildTransactions,
    inventoryMovements,
    projectAllocations,
  };
}

// Overnight reliability closeout (2026-09-12, task 3): restoreFullBackupSnapshot
// used to return Promise<void> and propagate the first thrown error straight
// out, aborting every later section regardless of whether that later
// section actually depended on the one that failed -- the caller
// (main.tsx's importBackup) could not tell which section failed, how many
// succeeded, or show anything more specific than "some information may
// already have been restored." This does NOT make the restore atomic (see
// this function's own header note below on what still isn't) -- it makes
// a partial failure honestly reported instead of either a false blanket
// success or an equally uninformative blanket failure.
export type RestoreSectionName =
  | "inventoryItems"
  | "deviceRecipes"
  | "projectSites"
  | "purchaseRequests"
  | "projectDocuments"
  | "movementsBuildsAllocations";

export type RestoreSectionResult = {
  section: RestoreSectionName;
  // false when the snapshot had nothing for this section (nothing to
  // restore is not a failure) -- succeeded/error are meaningless when
  // attempted is false.
  attempted: boolean;
  succeeded: boolean;
  count: number;
  error?: string;
};

export type RestoreOutcome = {
  // true only when every attempted section succeeded. A snapshot with
  // nothing to restore at all (every section skipped) is also ok: true --
  // there was nothing to fail.
  ok: boolean;
  sections: RestoreSectionResult[];
};

// Checked before any write begins -- a malformed snapshot (the wrong
// top-level shape for a field that must be an array) is rejected outright
// here, rather than discovered partway through as a raw TypeError (e.g.
// `.map is not a function`) deep inside whichever section happens to hit
// it first, with earlier sections already committed. This is a shallow
// shape check, not a full per-row schema validation -- each section's own
// save function (and, for equipment recipes and eventually project BOM
// lines, the RPC itself) still validates its own row contents.
function validateBackupSnapshotShape(snapshot: Partial<FullBackupSnapshot>): void {
  const arrayFields: Array<keyof FullBackupSnapshot> = [
    "projectSites",
    "inventoryItems",
    "deviceRecipes",
    "purchaseRequests",
    "projectDocuments",
    "buildTransactions",
    "inventoryMovements",
    "projectAllocations",
  ];
  for (const field of arrayFields) {
    const value = snapshot[field];
    if (value !== undefined && !Array.isArray(value)) {
      throw new Error("This backup file's structure is invalid and cannot be restored.");
    }
  }
}

export async function restoreFullBackupSnapshot(snapshot: Partial<FullBackupSnapshot>, accessToken?: string): Promise<RestoreOutcome> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, sections: [] };
  }

  validateBackupSnapshotShape(snapshot);

  const sections: RestoreSectionResult[] = [];

  // Each section runs independently -- catches its own failure, records
  // it, and lets every remaining section still be attempted, rather than
  // aborting the whole restore at the first failure. Order is preserved
  // from before (same dependency chain as the live debounce-save effects:
  // inventory items and equipment recipes first, since BOM lines/
  // components resolve item names against them; then projects; then
  // purchase requests and documents, independent of the above; then
  // builds -> movements -> allocations last, each resolving ids from the
  // one before it) -- a later section attempting to run after an earlier
  // one failed can still only produce more unresolved (null) links where
  // its own lookups don't find a match, never a crash, since every
  // resolution in this chain already tolerates a lookup miss by design.
  //
  // What this does NOT do: make the restore atomic. A section that
  // partially writes before throwing (e.g. saveInventoryItems' own
  // item-metadata write succeeding while its balance write then fails)
  // still leaves that partial state committed -- this function reports
  // that honestly as a failed section, it does not roll it back. Whole-
  // backup atomicity remains impractical for the reasons documented in
  // PRODUCT_ERROR_VISIBILITY_AUDIT.md's restore trace (A2.5).
  async function runSection(section: RestoreSectionName, count: number, run: () => Promise<unknown>): Promise<void> {
    if (count === 0) {
      sections.push({ section, attempted: false, succeeded: false, count: 0 });
      return;
    }
    try {
      await run();
      sections.push({ section, attempted: true, succeeded: true, count });
    } catch (error) {
      const message = error instanceof Error ? error.message : "An unknown error occurred.";
      console.error(`restoreFullBackupSnapshot: section "${section}" failed:`, error);
      sections.push({ section, attempted: true, succeeded: false, count, error: message });
    }
  }

  await runSection("inventoryItems", snapshot.inventoryItems?.length ?? 0, () => saveInventoryItems(snapshot.inventoryItems ?? [], accessToken));
  await runSection("deviceRecipes", snapshot.deviceRecipes?.length ?? 0, () => saveDeviceRecipes(snapshot.deviceRecipes ?? [], accessToken));
  await runSection("projectSites", snapshot.projectSites?.length ?? 0, () => saveProjectSites(snapshot.projectSites ?? [], accessToken));
  await runSection("purchaseRequests", snapshot.purchaseRequests?.length ?? 0, () => saveRestoredPurchaseRequests(snapshot.purchaseRequests ?? [], accessToken));
  await runSection("projectDocuments", snapshot.projectDocuments?.length ?? 0, () => saveRestoredProjectDocuments(snapshot.projectDocuments ?? [], accessToken));
  const movementsCount = (snapshot.buildTransactions?.length ?? 0) + (snapshot.inventoryMovements?.length ?? 0) + (snapshot.projectAllocations?.length ?? 0);
  await runSection("movementsBuildsAllocations", movementsCount, () =>
    saveMovementsBuildsAllocations(snapshot.buildTransactions ?? [], snapshot.inventoryMovements ?? [], snapshot.projectAllocations ?? [], accessToken),
  );

  return { ok: sections.every((section) => !section.attempted || section.succeeded), sections };
}

// Purchase Requests and Project Documents don't have a bulk upsert function
// (their live persistence is per-row create/update, not whole-array
// debounce-save), so restore gets its own small bulk path for each, keyed
// on `id` -- which, for both of these, already is the real Postgres row id
// (there's no separate client-side legacy id for either entity), so
// upserting by id is exactly right for a restore.
async function saveRestoredPurchaseRequests(requests: PurchaseRequest[], accessToken: string): Promise<void> {
  const payload = requests.map((request) => ({
    id: request.id,
    request_number: request.requestNumber,
    sku_snapshot: request.sku,
    item_name_snapshot: request.itemName,
    quantity_requested: request.quantity,
    reason: pgPurchaseReason(request.reason),
    source_type: pgPurchaseSourceType(request.reason),
    source_ref: request.sourceRef ?? null,
    project_name: request.projectName ?? null,
    procurement_track: request.procurementTrack ?? "warehouse_stock",
    preferred_vendor: request.preferredVendor ?? null,
    po_number: request.poNumber ?? null,
    expected_date: request.expectedDate ?? null,
    estimated_unit_cost: request.estimatedUnitCost,
    quantity_received: request.receivedQuantity ?? 0,
    status: pgPurchaseStatus(request.status),
    notes: request.notes,
    created_at: request.createdAt,
  }));
  // Overnight audit (2026-09-11, task 5): this POST was completely
  // unchecked -- its result wasn't even assigned to a variable. Safe to
  // verify here -- the only caller, restoreFullBackupSnapshot, is itself
  // only ever called from handleImportBackup's reader.onload, which
  // already has a real try/catch with an honest, non-overclaiming
  // message ("Backup restore did not complete. Some information may
  // already have been restored.") -- an isolated response check, not a
  // redesign of the restore workflow.
  const response = await fetch(supabaseUrl("purchase_requests?on_conflict=id"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`saveRestoredPurchaseRequests failed (${response.status}): ${bodyText}`);
    throw new Error("Some purchase requests could not be restored.");
  }
  const savedRows = (await response.json().catch(() => [])) as unknown[];
  if (savedRows.length !== payload.length) {
    console.error(`saveRestoredPurchaseRequests returned ${savedRows.length} row(s), expected ${payload.length} -- integrity check failed.`);
    throw new Error("Some purchase requests could not be restored.");
  }
}

async function saveRestoredProjectDocuments(docs: ProjectDocument[], accessToken: string): Promise<void> {
  // Deterministic restore (2026-09-12, overnight reliability closeout task
  // 3): every document a real snapshot carries already has its own real,
  // previously-assigned document_number (now selected/mapped by
  // loadProjectDocuments -- see ProjectDocument.documentNumber's own
  // comment). Using it here means restoring the SAME snapshot twice
  // writes the exact same document_number both times, closing the gap
  // PRODUCT_ERROR_VISIBILITY_AUDIT.md flagged (a retried restore
  // previously produced a different number on every attempt, since it was
  // freshly generated from Date.now() every call). The Date.now()-based
  // fallback is kept ONLY for a snapshot exported before this field
  // existed -- a document from a legacy snapshot with no recorded number
  // still needs something to write, and inventing one on restore is no
  // worse than what already happened for every restore before this fix.
  const payload = docs.map((doc, index) => ({
    id: doc.id,
    document_number: doc.documentNumber ?? `DOC-RESTORE-${Date.now().toString(36).toUpperCase()}-${index}`,
    project_name: doc.project || null,
    document_type: appDocumentType(doc.type),
    file_name: doc.name,
    file_size_bytes: doc.size,
    status: pgDocumentStatus(doc.status),
    storage_status: pgDocumentStorage(doc.storage),
    storage_provider: doc.storage === "Supabase Storage" ? "supabase_storage" : "browser",
    file_url: doc.storagePath ?? null,
    uploaded_at: doc.uploadedAt ?? new Date().toISOString(),
    uploaded_by_email: doc.uploadedByEmail ?? null,
    // Added on review (2026-09-11): traced against the ProjectDocument type
    // (persistence.ts) and the live per-document create path a few hundred
    // lines above, which already writes both of these unconditionally.
    // Migration 080 (purchase_order_id/purchase_request_id) is confirmed
    // applied in production, same as migration 068 (uploaded_by_email,
    // already carried above) -- the restore payload was simply missing two
    // real, schema-backed fields the live write path already sends, not a
    // speculative addition.
    purchase_order_id: doc.purchaseOrderId ?? null,
    purchase_request_id: doc.purchaseRequestId ?? null,
  }));
  // Correction (2026-09-11, review): this used to retry on any 400 after
  // stripping uploaded_by_email, on the theory that column might not exist
  // yet. Migrations 068 and 080 are both confirmed applied in production --
  // uploaded_by_email, purchase_order_id, and purchase_request_id are all
  // real, live columns. Retrying on ANY 400 (not just a missing-column one)
  // risked turning an unrelated validation error into a second request that
  // silently omitted provenance and succeeded anyway -- removed entirely,
  // not narrowed. Every non-OK response is now a real, reported failure.
  const response = await fetch(supabaseUrl("project_documents?on_conflict=id"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`saveRestoredProjectDocuments failed (${response.status}): ${bodyText}`);
    throw new Error("Some project documents could not be restored.");
  }
  const savedRows = (await response.json().catch(() => [])) as unknown[];
  if (savedRows.length !== payload.length) {
    console.error(`saveRestoredProjectDocuments returned ${savedRows.length} row(s), expected ${payload.length} -- integrity check failed.`);
    throw new Error("Some project documents could not be restored.");
  }
}

// Purchase Orders (migration 032). Before this, the Purchasing page's
// "Imported Purchase Queue" / "Order Line Items" / "Spend By Project"
// sections all read from a hardcoded array of 7 historical vendor orders --
// there was no way to add a new order or change a status, and nothing was
// ever actually saved. This is a real per-row create/update (like Purchase
// Requests), not a whole-array debounce-save, since there's no complex
// synchronous mutation logic that needs it.
export type PurchaseLineCategory = "Compute" | "Storage" | "Network" | "Power" | "Enclosure" | "Hardware" | "Rack" | "Other";

export type PurchaseOrderLine = {
  // Present for any line that's actually been saved (id is the DB primary
  // key) -- absent only for a line still being drafted client-side before
  // "Save Purchase" is clicked. Needed to log a receipt against the exact
  // line, since lines have no other stable identity (item name can repeat).
  id?: string;
  name: string;
  category: PurchaseLineCategory;
  qty: number;
  unitCost: number;
  lineTotal?: number;
  // purchase_order_lines.quantity_received has existed since migration
  // 001 but was never read/written by the app until the receiving-log
  // work (migration 082). Defaults to 0.
  receivedQty: number;
};

export type PurchaseOrderFile = {
  id: string;
  purchaseOrderId: string;
  storagePath: string;
  fileName: string;
  description: string;
  uploadedAt: string;
  uploadedByEmail: string;
};

export type PurchaseOrderReceipt = {
  id: string;
  purchaseOrderId: string;
  purchaseOrderLineId?: string;
  itemName: string;
  qty: number;
  receivedByEmail?: string;
  receivedAt: string;
};

export type PurchaseOrder = {
  id: string;
  number: string;
  vendor: string;
  date: string;
  projectRef: string;
  // "Ordered"/"Received" (migration 081) are the real lifecycle for orders
  // created through "Create Purchase" -- Ordered means placed and waiting
  // to arrive, Received closes it out. "Imported"/"In Processing"/"On
  // Hold" are kept for older rows created before that flow existed.
  status: "Imported" | "In Processing" | "On Hold" | "Ordered" | "Received";
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  sourceFile: string;
  shipTo: string;
  paymentNote: string;
  lines: PurchaseOrderLine[];
  // The Purchase Request this order was created from, if any (via "Create
  // Purchase" on a Request Queue row) -- undefined for orders entered
  // directly with no originating request.
  sourceRequestId?: string;
  // Paperwork/photos attached directly to this exact order (migration
  // 081) -- the order confirmation attached at creation, and receiving
  // photos/packing slips attached once it arrives. Not a shared bucket.
  files: PurchaseOrderFile[];
  // Receiving log (migration 082) -- one entry per receiving action,
  // newest first. Not the same as the running total on each line; this
  // is the audit trail of who checked in what and when.
  receipts: PurchaseOrderReceipt[];
  // Who placed the order (migration 084).
  createdByEmail?: string;
  // "On Hold" reason log (migration 085) -- newest first. Ordered/Received
  // are driven by real events; On Hold is the one manual status change,
  // and it always carries a reason on record.
  holds: PurchaseOrderHold[];
};

export type PurchaseOrderHold = {
  id: string;
  purchaseOrderId: string;
  reason: string;
  placedByEmail?: string;
  placedAt: string;
};

type PurchaseOrderLineRow = {
  id?: string;
  item_name: string;
  category: string | null;
  quantity_ordered: number | string;
  unit_cost: number | string;
  line_total: number | string | null;
  quantity_received?: number | string | null;
};

type PurchaseOrderReceiptRow = {
  id: string;
  purchase_order_id: string;
  purchase_order_line_id: string | null;
  item_name: string;
  qty: number | string;
  received_by_email: string | null;
  received_at: string;
};

function mapPurchaseOrderReceiptRow(row: PurchaseOrderReceiptRow): PurchaseOrderReceipt {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    purchaseOrderLineId: row.purchase_order_line_id ?? undefined,
    itemName: row.item_name,
    qty: Number(row.qty) || 0,
    receivedByEmail: row.received_by_email ?? undefined,
    receivedAt: row.received_at,
  };
}

type PurchaseOrderFileRow = {
  id: string;
  purchase_order_id: string;
  storage_path: string;
  file_name: string | null;
  description: string | null;
  uploaded_at: string;
  uploaded_by_email: string | null;
};

function mapPurchaseOrderFileRow(row: PurchaseOrderFileRow): PurchaseOrderFile {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    storagePath: row.storage_path,
    fileName: row.file_name ?? "",
    description: row.description ?? "",
    uploadedAt: row.uploaded_at,
    uploadedByEmail: row.uploaded_by_email ?? "",
  };
}

type PurchaseOrderRow = {
  id: string;
  po_number: string;
  app_status: string;
  requested_date: string;
  subtotal: number | string;
  tax_amount: number | string;
  shipping_amount: number | string;
  total_amount: number | string | null;
  project_name: string | null;
  ship_to: string | null;
  payment_note: string | null;
  source_file: string | null;
  vendor: { name: string } | null;
  purchase_order_lines: PurchaseOrderLineRow[];
  source_request_id?: string | null;
  purchase_order_files?: PurchaseOrderFileRow[] | null;
  purchase_order_receipts?: PurchaseOrderReceiptRow[] | null;
  created_by_email?: string | null;
  purchase_order_holds?: PurchaseOrderHoldRow[] | null;
};

type PurchaseOrderHoldRow = {
  id: string;
  purchase_order_id: string;
  reason: string;
  placed_by_email: string | null;
  placed_at: string;
};

function mapPurchaseOrderHoldRow(row: PurchaseOrderHoldRow): PurchaseOrderHold {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    reason: row.reason,
    placedByEmail: row.placed_by_email ?? undefined,
    placedAt: row.placed_at,
  };
}

function appPoCategory(category: string | null): PurchaseLineCategory {
  const allowed: PurchaseLineCategory[] = ["Compute", "Storage", "Network", "Power", "Enclosure", "Hardware", "Rack", "Other"];
  return (allowed as string[]).includes(category ?? "") ? (category as PurchaseLineCategory) : "Other";
}

const PURCHASE_ORDER_STATUSES: PurchaseOrder["status"][] = ["Imported", "In Processing", "On Hold", "Ordered", "Received"];

function pgPoStatus(status: PurchaseOrder["status"]): string {
  switch (status) {
    case "In Processing": return "ordered";
    case "On Hold": return "submitted";
    case "Ordered": return "ordered";
    case "Received": return "received";
    default: return "received";
  }
}

function mapPurchaseOrderLineRow(row: PurchaseOrderLineRow): PurchaseOrderLine {
  return {
    id: row.id,
    name: row.item_name,
    category: appPoCategory(row.category),
    qty: Number(row.quantity_ordered) || 0,
    unitCost: Number(row.unit_cost) || 0,
    lineTotal: row.line_total !== null ? Number(row.line_total) || undefined : undefined,
    receivedQty: Number(row.quantity_received) || 0,
  };
}

function mapPurchaseOrderRow(row: PurchaseOrderRow): PurchaseOrder {
  const subtotal = Number(row.subtotal) || 0;
  const tax = Number(row.tax_amount) || 0;
  const shipping = Number(row.shipping_amount) || 0;
  return {
    id: row.id,
    number: row.po_number,
    vendor: row.vendor?.name ?? "Unknown vendor",
    date: row.requested_date,
    projectRef: row.project_name ?? "",
    status: (PURCHASE_ORDER_STATUSES as string[]).includes(row.app_status) ? (row.app_status as PurchaseOrder["status"]) : "Imported",
    subtotal,
    tax,
    shipping,
    total: row.total_amount !== null && row.total_amount !== undefined ? Number(row.total_amount) || subtotal + tax + shipping : subtotal + tax + shipping,
    sourceFile: row.source_file ?? "",
    shipTo: row.ship_to ?? "",
    paymentNote: row.payment_note ?? "",
    sourceRequestId: row.source_request_id ?? undefined,
    files: (row.purchase_order_files ?? []).map(mapPurchaseOrderFileRow),
    lines: (row.purchase_order_lines ?? []).map(mapPurchaseOrderLineRow),
    receipts: (row.purchase_order_receipts ?? [])
      .map(mapPurchaseOrderReceiptRow)
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)),
    createdByEmail: row.created_by_email ?? undefined,
    holds: (row.purchase_order_holds ?? [])
      .map(mapPurchaseOrderHoldRow)
      .sort((a, b) => (a.placedAt < b.placedAt ? 1 : -1)),
  };
}

const PURCHASE_ORDER_LINES_EMBED = "purchase_order_lines(id,item_name,category,quantity_ordered,unit_cost,line_total,quantity_received)";
const PURCHASE_ORDER_SELECT_BASE =
  `id,po_number,app_status,requested_date,subtotal,tax_amount,shipping_amount,total_amount,project_name,ship_to,payment_note,source_file,vendor:vendors(name),${PURCHASE_ORDER_LINES_EMBED}`;
const PURCHASE_ORDER_SELECT_WITH_LINKS =
  `${PURCHASE_ORDER_SELECT_BASE},source_request_id,purchase_order_files(id,purchase_order_id,storage_path,file_name,description,uploaded_at,uploaded_by_email)`;
const PURCHASE_ORDER_SELECT_WITH_RECEIPTS =
  `${PURCHASE_ORDER_SELECT_WITH_LINKS},purchase_order_receipts(id,purchase_order_id,purchase_order_line_id,item_name,qty,received_by_email,received_at)`;
const PURCHASE_ORDER_SELECT_WITH_CREATED_BY = `${PURCHASE_ORDER_SELECT_WITH_RECEIPTS},created_by_email`;
const PURCHASE_ORDER_SELECT =
  `${PURCHASE_ORDER_SELECT_WITH_CREATED_BY},purchase_order_holds(id,purchase_order_id,reason,placed_by_email,placed_at)`;

export async function loadPurchaseOrders(accessToken?: string): Promise<PurchaseOrder[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetchWithDeletedAtFallback(supabaseUrl(`purchase_orders?select=${PURCHASE_ORDER_SELECT}&purchase_order_files.deleted_at=is.null&order=requested_date.desc`), supabaseHeaders(accessToken));
  if (!response.ok && response.status === 400) {
    // Migration 085 (purchase_order_holds) hasn't run yet -- retry without it.
    const holdsResponse = await fetch(supabaseUrl(`purchase_orders?select=${PURCHASE_ORDER_SELECT_WITH_CREATED_BY}&order=requested_date.desc`), {
      headers: supabaseHeaders(accessToken),
    });
    if (holdsResponse.ok) {
      const holdsRows = (await holdsResponse.json()) as Array<Omit<PurchaseOrderRow, "purchase_order_holds">>;
      return holdsRows.map((row) => mapPurchaseOrderRow({ ...row, purchase_order_holds: [] }));
    }
    if (holdsResponse.status !== 400) {
      return [];
    }
    // Migration 084 (created_by_email) hasn't run yet -- retry without it.
    const receiptsResponse = await fetch(supabaseUrl(`purchase_orders?select=${PURCHASE_ORDER_SELECT_WITH_RECEIPTS}&order=requested_date.desc`), {
      headers: supabaseHeaders(accessToken),
    });
    if (receiptsResponse.ok) {
      const receiptsRows = (await receiptsResponse.json()) as Array<Omit<PurchaseOrderRow, "created_by_email">>;
      return receiptsRows.map((row) => mapPurchaseOrderRow({ ...row, created_by_email: null }));
    }
    if (receiptsResponse.status !== 400) {
      return [];
    }
    // Migration 082 (purchase_order_receipts) hasn't run yet -- retry
    // without that embed.
    const midResponse = await fetch(supabaseUrl(`purchase_orders?select=${PURCHASE_ORDER_SELECT_WITH_LINKS}&order=requested_date.desc`), {
      headers: supabaseHeaders(accessToken),
    });
    if (midResponse.ok) {
      const midRows = (await midResponse.json()) as Array<Omit<PurchaseOrderRow, "purchase_order_receipts" | "created_by_email">>;
      return midRows.map((row) => mapPurchaseOrderRow({ ...row, purchase_order_receipts: [], created_by_email: null }));
    }
    if (midResponse.status === 400) {
      // Migration 081 hasn't run either -- retry with just the always-safe
      // base columns (purchase_order_lines.id/quantity_received have
      // existed since migration 001, so those stay in every tier).
      const baseResponse = await fetch(supabaseUrl(`purchase_orders?select=${PURCHASE_ORDER_SELECT_BASE}&order=requested_date.desc`), {
        headers: supabaseHeaders(accessToken),
      });
      if (!baseResponse.ok) {
        return [];
      }
      const baseRows = (await baseResponse.json()) as Array<Omit<PurchaseOrderRow, "source_request_id" | "purchase_order_files" | "purchase_order_receipts" | "created_by_email">>;
      return baseRows.map((row) => mapPurchaseOrderRow({ ...row, source_request_id: null, purchase_order_files: [], purchase_order_receipts: [], created_by_email: null }));
    }
    return [];
  }
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as PurchaseOrderRow[];
  return rows.map(mapPurchaseOrderRow);
}

// The `vendors` table (migration 001) has been real -- name, contact_name,
// email, phone, website, notes, is_active, all with a working RLS policy
// -- since the very first schema, but only ever touched via
// getOrCreateVendorId below (a silent upsert-by-name when a PO is
// submitted). No page ever let anyone see or fill in the directory info.
// Added a real Vendors page 2026-08-19 (Inventory & Purchasing nav merge).
export type Vendor = {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  website: string;
  notes: string;
  isActive: boolean;
};

type VendorRow = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  is_active: boolean;
};

const VENDOR_SELECT = "id,name,contact_name,email,phone,website,notes,is_active";

function mapVendorRow(row: VendorRow): Vendor {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    website: row.website ?? "",
    notes: row.notes ?? "",
    isActive: row.is_active,
  };
}

export async function loadVendors(accessToken?: string): Promise<Vendor[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl(`vendors?select=${VENDOR_SELECT}&order=name.asc`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as VendorRow[];
  return rows.map(mapVendorRow);
}

export async function createVendor(
  input: { name: string; contactName?: string; email?: string; phone?: string; website?: string; notes?: string },
  accessToken?: string,
): Promise<Vendor | null> {
  if (!isRemotePersistenceConfigured() || !accessToken || !input.name.trim()) {
    return null;
  }
  const response = await fetch(supabaseUrl("vendors?on_conflict=name"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      name: input.name.trim(),
      contact_name: input.contactName || null,
      email: input.email || null,
      phone: input.phone || null,
      website: input.website || null,
      notes: input.notes || null,
    }),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as VendorRow[];
  return rows[0] ? mapVendorRow(rows[0]) : null;
}

export async function updateVendor(
  id: string,
  updates: Partial<{ name: string; contactName: string; email: string; phone: string; website: string; notes: string; isActive: boolean }>,
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.contactName !== undefined) payload.contact_name = updates.contactName || null;
  if (updates.email !== undefined) payload.email = updates.email || null;
  if (updates.phone !== undefined) payload.phone = updates.phone || null;
  if (updates.website !== undefined) payload.website = updates.website || null;
  if (updates.notes !== undefined) payload.notes = updates.notes || null;
  if (updates.isActive !== undefined) payload.is_active = updates.isActive;
  if (Object.keys(payload).length === 0) {
    return;
  }
  // Overnight audit (2026-09-11, task 2): this PATCH was completely
  // unchecked. Safe to verify here -- the caller (handleUpdateVendor) was
  // wrapped in a try/catch reusing the existing setVendorStatus channel.
  // Deliberately does NOT revert the caller's optimistic local update on
  // failure -- the status message alone is the safe, visible signal.
  const response = await fetch(supabaseUrl(`vendors?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateVendor failed for vendor ${id} (${response.status}): ${bodyText}`);
    throw new Error("Could not save this change.");
  }
  const rows = (await response.json().catch(() => [])) as unknown[];
  if (rows.length === 0) {
    console.error(`updateVendor affected 0 rows for vendor ${id} -- likely blocked by RLS or a missing vendor.`);
    throw new Error("Could not save this change.");
  }
}

async function getOrCreateVendorId(name: string, accessToken: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }
  const response = await fetch(supabaseUrl("vendors?on_conflict=name"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ name: trimmed }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`getOrCreateVendorId: vendors upsert failed for "${trimmed}" (${response.status}): ${bodyText}`);
    return null;
  }
  const rows = (await response.json()) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

export async function createPurchaseOrder(
  input: {
    number: string;
    vendor: string;
    date: string;
    projectRef: string;
    status: PurchaseOrder["status"];
    subtotal: number;
    tax: number;
    shipping: number;
    sourceFile: string;
    shipTo: string;
    paymentNote: string;
    lines: Array<{ name: string; category: PurchaseLineCategory; qty: number; unitCost: number }>;
    sourceRequestId?: string;
    createdByEmail?: string;
  },
  accessToken?: string,
): Promise<PurchaseOrder | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const vendorId = await getOrCreateVendorId(input.vendor, accessToken);
  if (!vendorId) {
    return null;
  }
  const orderPayload = {
    po_number: input.number,
    vendor_id: vendorId,
    app_status: input.status,
    status: pgPoStatus(input.status),
    requested_date: input.date,
    subtotal: input.subtotal,
    tax_amount: input.tax,
    shipping_amount: input.shipping,
    project_name: input.projectRef || null,
    ship_to: input.shipTo || null,
    payment_note: input.paymentNote || null,
    source_file: input.sourceFile || null,
    source_request_id: input.sourceRequestId || null,
    created_by_email: input.createdByEmail || null,
  };
  let orderResponse = await fetch(supabaseUrl("purchase_orders"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify(orderPayload),
  });
  if (!orderResponse.ok && orderResponse.status === 400) {
    const { source_request_id: _sourceRequestId, created_by_email: _createdByEmail, ...fallbackPayload } = orderPayload;
    orderResponse = await fetch(supabaseUrl("purchase_orders"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify(fallbackPayload),
    });
  }
  if (!orderResponse.ok) {
    throw new Error(`Could not save purchase order: ${orderResponse.status}`);
  }
  const orderRows = (await orderResponse.json()) as Array<{ id: string }>;
  const orderId = orderRows[0]?.id;
  if (!orderId) {
    return null;
  }

  const linePayload = input.lines.map((line, index) => ({
    purchase_order_id: orderId,
    item_name: line.name,
    category: line.category,
    quantity_ordered: line.qty,
    unit_cost: line.unitCost,
    line_sort: index,
  }));
  // Reviewed 2026-09-12 (overnight reliability closeout, task 5): this
  // write's failure used to be completely swallowed -- the response was
  // checked but a failure fell through to no-op, and the function's
  // return value then FABRICATED success by falling back to
  // `input.lines` (the client's own draft data, never actually written)
  // as if it had been saved. A purchasing team member would see a
  // "created" purchase order with line items on screen while
  // purchase_order_lines was actually empty in the database. Now: a
  // failure is logged with real status/body, and lineRows honestly stays
  // empty -- the returned order reflects what is actually in the
  // database (an order header with zero lines), not what was attempted.
  // The order header write above already committed by this point
  // (non-atomic across these two requests, unchanged by this fix) --
  // this only stops the RETURNED DATA from lying about it.
  let lineRows: PurchaseOrderLineRow[] = [];
  if (linePayload.length > 0) {
    const lineResponse = await fetch(supabaseUrl("purchase_order_lines"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify(linePayload),
    });
    if (lineResponse.ok) {
      lineRows = (await lineResponse.json()) as PurchaseOrderLineRow[];
    } else {
      const bodyText = await lineResponse.text().catch(() => "");
      console.error(`createPurchaseOrder: purchase_order_lines write failed for order ${orderId} (${lineResponse.status}): ${bodyText}`);
    }
  }

  return {
    id: orderId,
    number: input.number,
    vendor: input.vendor,
    date: input.date,
    projectRef: input.projectRef,
    status: input.status,
    subtotal: input.subtotal,
    tax: input.tax,
    shipping: input.shipping,
    total: input.subtotal + input.tax + input.shipping,
    sourceFile: input.sourceFile,
    shipTo: input.shipTo,
    paymentNote: input.paymentNote,
    lines: lineRows.map(mapPurchaseOrderLineRow),
    sourceRequestId: input.sourceRequestId,
    createdByEmail: input.createdByEmail,
    files: [],
    receipts: [],
    holds: [],
  };
}

export async function updatePurchaseOrderStatus(id: string, status: PurchaseOrder["status"], accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`purchase_orders?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ app_status: status, status: pgPoStatus(status) }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not update purchase order status") };
  }
  const updatedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (updatedRows.length === 0) {
    return { ok: false, error: "Status change didn't affect anything -- you may not have permission." };
  }
  return { ok: true };
}

// Per-line receiving + the receiving log (migration 082). Two separate
// writes, not a DB transaction/RPC (matches this codebase's existing
// simple-write style elsewhere) -- the line's running total, and a
// standalone log row snapshotting who received what and when.
export async function updatePurchaseOrderLineReceivedQty(lineId: string, receivedQty: number, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const response = await fetch(supabaseUrl(`purchase_order_lines?id=eq.${lineId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ quantity_received: receivedQty }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updatePurchaseOrderLineReceivedQty: PATCH failed for line ${lineId} (${response.status}): ${bodyText}`);
  }
  return response.ok;
}

export async function createPurchaseOrderReceipt(
  input: {
    purchaseOrderId: string;
    purchaseOrderLineId?: string;
    itemName: string;
    qty: number;
    receivedByEmail?: string;
  },
  accessToken?: string,
): Promise<PurchaseOrderReceipt | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const response = await fetch(supabaseUrl("purchase_order_receipts"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      purchase_order_id: input.purchaseOrderId,
      purchase_order_line_id: input.purchaseOrderLineId ?? null,
      item_name: input.itemName,
      qty: input.qty,
      received_by_email: input.receivedByEmail ?? null,
    }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`createPurchaseOrderReceipt: purchase_order_receipts insert failed for order ${input.purchaseOrderId} (${response.status}): ${bodyText}`);
    return null;
  }
  const rows = (await response.json()) as PurchaseOrderReceiptRow[];
  if (!rows[0]) {
    console.error(`createPurchaseOrderReceipt: purchase_order_receipts insert for order ${input.purchaseOrderId} returned no row.`);
    return null;
  }
  return mapPurchaseOrderReceiptRow(rows[0]);
}

export async function createPurchaseOrderHold(
  input: { purchaseOrderId: string; reason: string; placedByEmail?: string },
  accessToken?: string,
): Promise<PurchaseOrderHold | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const response = await fetch(supabaseUrl("purchase_order_holds"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      purchase_order_id: input.purchaseOrderId,
      reason: input.reason,
      placed_by_email: input.placedByEmail ?? null,
    }),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as PurchaseOrderHoldRow[];
  return rows[0] ? mapPurchaseOrderHoldRow(rows[0]) : null;
}

// Paperwork attached directly to one Purchase Order (migration 081) -- the
// order confirmation attached at creation, plus receiving photos/packing
// slips attached once it arrives. Same shape as project_shipment_photos
// (see addProjectShipmentPhoto above), just keyed to purchase_order_id
// instead of shipment_id, and not restricted to images -- accepts PDFs too.
const PURCHASE_ORDER_FILE_BUCKET = "purchase-order-files";

export function buildPurchaseOrderFileStoragePath(purchaseOrderId: string, fileName: string): string {
  const stamp = Date.now().toString(36);
  return `${purchaseOrderId}/${stamp}-${sanitizeStoragePathSegment(fileName)}`;
}

export async function uploadPurchaseOrderFile(file: File, storagePath: string, accessToken?: string): Promise<boolean> {
  return uploadStorageObjectFile(PURCHASE_ORDER_FILE_BUCKET, file, storagePath, accessToken);
}

export async function getPurchaseOrderFileDownloadUrl(storagePath: string, accessToken?: string): Promise<string | null> {
  return getStorageObjectSignedUrl(PURCHASE_ORDER_FILE_BUCKET, storagePath, accessToken);
}

export async function addPurchaseOrderFile(
  purchaseOrderId: string,
  file: File,
  accessToken?: string,
  description?: string,
  uploaderEmail?: string,
): Promise<PurchaseOrderFile | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  try {
    const storagePath = buildPurchaseOrderFileStoragePath(purchaseOrderId, file.name);
    const uploaded = await uploadPurchaseOrderFile(file, storagePath, accessToken);
    if (!uploaded) {
      return null;
    }
    const response = await fetch(supabaseUrl("purchase_order_files"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify({
        purchase_order_id: purchaseOrderId,
        storage_path: storagePath,
        file_name: file.name,
        description: description || null,
        uploaded_by_email: uploaderEmail || null,
      }),
    });
    if (!response.ok) {
      console.error("addPurchaseOrderFile insert failed", response.status, await response.text().catch(() => ""));
      return null;
    }
    const rows = (await response.json()) as PurchaseOrderFileRow[];
    return rows[0] ? mapPurchaseOrderFileRow(rows[0]) : null;
  } catch (error) {
    console.error("addPurchaseOrderFile threw", error);
    return null;
  }
}

// Migration 088: soft delete only -- the Storage object is deliberately left
// in place (not physically removed) so a restored file still has something
// to point at. `storagePath` stays in the signature for callers/back-compat
// but is no longer used to delete anything here.
export async function deletePurchaseOrderFile(fileId: string, _storagePath: string, label: string, actorEmail: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  try {
    const response = await fetch(supabaseUrl(`purchase_order_files?id=eq.${fileId}`), {
      method: "PATCH",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
    });
    if (!response.ok) {
      return false;
    }
    const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
    if (deletedRows.length === 0) {
      return false;
    }
    await logDeletionEvent("purchase_order_file", fileId, label, "deleted", actorEmail, accessToken);
    return true;
  } catch (error) {
    console.error("deletePurchaseOrderFile threw", error);
    return false;
  }
}

export type DeletedPurchaseOrderFile = {
  id: string;
  purchaseOrderId: string;
  poNumber: string;
  fileName: string;
  deletedByEmail: string;
  deletedAt: string;
};

type DeletedPurchaseOrderFileRow = {
  id: string;
  purchase_order_id: string;
  file_name: string | null;
  deleted_by_email: string | null;
  deleted_at: string;
  purchase_orders: { po_number: string } | { po_number: string }[] | null;
};

export async function loadDeletedPurchaseOrderFiles(accessToken?: string): Promise<DeletedPurchaseOrderFile[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(
    supabaseUrl("purchase_order_files?select=id,purchase_order_id,file_name,deleted_by_email,deleted_at,purchase_orders(po_number)&deleted_at=not.is.null&order=deleted_at.desc"),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as DeletedPurchaseOrderFileRow[];
  return rows.map((row) => {
    const po = Array.isArray(row.purchase_orders) ? row.purchase_orders[0] : row.purchase_orders;
    return {
      id: row.id,
      purchaseOrderId: row.purchase_order_id,
      poNumber: po?.po_number ?? "Unknown PO",
      fileName: row.file_name ?? "Untitled file",
      deletedByEmail: row.deleted_by_email ?? "",
      deletedAt: row.deleted_at,
    };
  });
}

export async function restorePurchaseOrderFile(fileId: string, label: string, actorEmail: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const response = await fetch(supabaseUrl(`purchase_order_files?id=eq.${fileId}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: null, deleted_at: null }),
  });
  if (!response.ok) {
    return false;
  }
  const restoredRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (restoredRows.length === 0) {
    return false;
  }
  await logDeletionEvent("purchase_order_file", fileId, label, "restored", actorEmail, accessToken);
  return true;
}

// Sales Quote Builder (migration 033). A quote starts with a client/site and
// a count of garages and parking lots -- those counts generate one location
// row per garage/lot (see createSalesQuote) for the sales person to name and
// detail. The hardware rules engine that will size cameras/signs per
// location from these answers is a deliberate placeholder in the UI only;
// there's no rules table yet.
export type SalesQuoteLocationImage = {
  id: string;
  imageType: "photo" | "drawing";
  storagePath: string;
  fileName: string;
  description: string;
  uploadedAt: string;
  // Migration 064: who took/uploaded it and, best-effort, where -- captured
  // going forward only (existing rows have these as null/"" forever, since
  // the data was never recorded at the time).
  uploadedByEmail: string;
  lat: number | null;
  lng: number | null;
};

// Migration 056: an addable Sign/Space Sensor/Misc line at a specific
// location -- always tied to a real catalog item (unlike the quote-level
// BOM lines, which allow free text for labor/service rows), so the
// dropdown for these is always populated from the catalog, filtered
// differently per lineType in the UI.
export type SalesQuoteLocationItem = {
  id: string;
  quoteLocationId: string;
  lineType: "sign" | "sensor" | "misc" | "camera" | "vpu";
  catalogItemId: string | null;
  qty: number;
  lineSort: number;
  locationLabel: string;
  accessoryCatalogItemId: string | null;
  accessoryQty: number;
};

export type SalesQuoteLocation = {
  id: string;
  quoteId: string;
  locationType: "garage" | "lot";
  name: string;
  // Migration 074: see ProjectLocation.address -- same idea, pre-conversion.
  address: string;
  lineSort: number;
  fli: boolean;
  lpr: boolean;
  peopleCounting: boolean;
  // Migration 056: which specific catalog camera model is used for each
  // checked-on capability, instead of just recording that the capability
  // exists. Null until a rep picks a model.
  fliCameraItemId: string | null;
  lprCameraItemId: string | null;
  peopleCountingCameraItemId: string | null;
  entriesCount: number;
  exitsCount: number;
  levelsCount: number;
  images: SalesQuoteLocationImage[];
  signLines: SalesQuoteLocationItem[];
  sensorLines: SalesQuoteLocationItem[];
  miscLines: SalesQuoteLocationItem[];
  cameraLines: SalesQuoteLocationItem[];
  vpuLines: SalesQuoteLocationItem[];
};

export type SalesQuoteBomLine = {
  id: string;
  quoteId: string;
  item: string;
  qty: number;
  notes: string;
  // Optional link to a real Product Catalog item (migration 053). Nullable
  // on purpose: real proposals mix catalog-backed product rows (which pull
  // image/description/datasheet automatically) with free-text labor/service
  // rows -- "Project Management Hours", "Travel and Related Expenses" --
  // that have no catalog entry at all.
  catalogItemId: string | null;
  // Migration 057: set when this line was auto-generated by "Pull Location
  // Hardware into Quote BOM" (see main.tsx) from a Site Builder location's
  // camera picks / Sign / Space Sensor / Misc lines -- null for anything a
  // rep typed in directly at the quote level. Lets that pull be
  // regenerate-safe (replace only the lines it previously created) instead
  // of piling up duplicates on every click.
  sourceLocationId: string | null;
};

export type SalesQuote = {
  id: string;
  // Migration 066: stable "SQ-2026-0001" reference, assigned once at
  // creation (server-side, via a trigger) -- same convention as Projects'
  // PRJ-#### refs.
  quoteRef: string;
  clientName: string;
  siteName: string;
  city: string;
  createdByEmail: string;
  createdAt: string;
  // Migration 066: set when status moves to closed_won/closed_lost, cleared
  // if reopened to "open". Empty string means never closed (or reopened).
  closedAt: string;
  // Deal status -- only "closed_won" quotes are offered as a BOM source
  // when a PM builds a Project (see main.tsx's "Pull BOM from Closed
  // Sales"). Defaults to "open" for every quote until someone marks it.
  status: "open" | "closed_won" | "closed_lost";
  locations: SalesQuoteLocation[];
  // Persisted, editable hardware/BOM list for this quote -- separate from
  // the live-computed "Recommended Hardware" summary (which is just a
  // read-only rollup of the location checkboxes/counts). This is what
  // actually gets pulled into a Project once the deal closes, and what the
  // relocated Pre-Sales Quick Estimate calculator writes into.
  bomLines: SalesQuoteBomLine[];
  // Migration 053: needed to actually send a Quote Proposal to a client.
  clientEmail: string;
  // Per-deal executive-summary paragraph a rep types -- the one
  // hand-written part of a proposal; everything else pulls from the BOM or
  // the shared proposal_template_sections boilerplate.
  proposalSummary: string;
  // Migration 060: rest of the Site Intake Questionnaire's "Client &
  // Contact Details" fields, moved up to the quick sheet so a rep only
  // types them once (the questionnaire pre-fills from these).
  contactFullName: string;
  contactPhone: string;
  preferredCommunication: string;
  // Migration 061: real addresses for both the site and the client company
  // -- city (site) already existed above.
  siteStreetAddress: string;
  siteState: string;
  siteZip: string;
  clientStreetAddress: string;
  clientCity: string;
  clientState: string;
  clientZip: string;
  // Migration 073: the actual signed SaaS contract terms -- carries over
  // to the Project once this quote closes (see createProjectFromClosedWonQuote).
  saasType: string;
  saasContractAmount: number | null;
  saasBillingFrequency: "Monthly" | "Quarterly" | "Annual" | "";
  // Migration 076: the one-time hardware/install sale price -- distinct
  // from saasContractAmount above (a separate recurring service contract).
  // Carries over to the Project when created from a Closed - Won quote,
  // same one-time-copy pattern as the SaaS fields.
  saleAmount: number | null;
};

type SalesQuoteLocationImageRow = {
  id: string;
  image_type: string;
  storage_path: string;
  file_name: string | null;
  description: string | null;
  uploaded_at: string;
  uploaded_by_email: string | null;
  photo_lat: number | string | null;
  photo_lng: number | string | null;
};

type SalesQuoteLocationItemRow = {
  id: string;
  quote_location_id: string;
  line_type: string;
  catalog_item_id: string | null;
  qty: number | string;
  line_sort: number;
  location_label: string | null;
  accessory_catalog_item_id: string | null;
  accessory_qty: number | string;
};

type SalesQuoteLocationRow = {
  id: string;
  quote_id: string;
  location_type: string;
  name: string;
  address: string | null;
  line_sort: number;
  fli: boolean;
  lpr: boolean;
  people_counting: boolean;
  fli_camera_item_id: string | null;
  lpr_camera_item_id: string | null;
  people_counting_camera_item_id: string | null;
  entries_count: number | string;
  exits_count: number | string;
  levels_count: number | string;
  sales_quote_location_images: SalesQuoteLocationImageRow[];
  sales_quote_location_items: SalesQuoteLocationItemRow[];
};

type SalesQuoteBomLineRow = {
  id: string;
  quote_id: string;
  item_name: string;
  qty: number | string;
  notes: string | null;
  line_sort: number;
  catalog_item_id: string | null;
  source_location_id: string | null;
};

type SalesQuoteRow = {
  id: string;
  quote_ref: string | null;
  client_name: string;
  site_name: string;
  city: string | null;
  created_by_email: string | null;
  created_at: string;
  closed_at: string | null;
  status: string | null;
  sales_quote_locations: SalesQuoteLocationRow[];
  sales_quote_bom_lines: SalesQuoteBomLineRow[];
  client_email: string | null;
  proposal_summary: string | null;
  contact_full_name: string | null;
  contact_phone: string | null;
  preferred_communication: string | null;
  site_street_address: string | null;
  site_state: string | null;
  site_zip: string | null;
  client_street_address: string | null;
  client_city: string | null;
  client_state: string | null;
  client_zip: string | null;
  saas_type: string | null;
  saas_contract_amount: number | string | null;
  saas_billing_frequency: string | null;
  sale_amount: number | string | null;
};

function mapSalesQuoteLocationImageRow(row: SalesQuoteLocationImageRow): SalesQuoteLocationImage {
  return {
    id: row.id,
    imageType: row.image_type === "drawing" ? "drawing" : "photo",
    storagePath: row.storage_path,
    fileName: row.file_name ?? "",
    description: row.description ?? "",
    uploadedAt: row.uploaded_at,
    uploadedByEmail: row.uploaded_by_email ?? "",
    lat: row.photo_lat === null || row.photo_lat === undefined ? null : Number(row.photo_lat),
    lng: row.photo_lng === null || row.photo_lng === undefined ? null : Number(row.photo_lng),
  };
}

function mapSalesQuoteLocationItemRow(row: SalesQuoteLocationItemRow): SalesQuoteLocationItem {
  return {
    id: row.id,
    quoteLocationId: row.quote_location_id,
    lineType: row.line_type as SalesQuoteLocationItem["lineType"],
    catalogItemId: row.catalog_item_id ?? null,
    qty: Number(row.qty) || 0,
    lineSort: row.line_sort,
    locationLabel: row.location_label ?? "",
    accessoryCatalogItemId: row.accessory_catalog_item_id ?? null,
    accessoryQty: Number(row.accessory_qty) || 0,
  };
}

function mapSalesQuoteLocationRow(row: SalesQuoteLocationRow): SalesQuoteLocation {
  const items = (row.sales_quote_location_items ?? []).map(mapSalesQuoteLocationItemRow).sort((a, b) => a.lineSort - b.lineSort);
  return {
    id: row.id,
    quoteId: row.quote_id,
    locationType: row.location_type === "lot" ? "lot" : "garage",
    name: row.name,
    address: row.address ?? "",
    lineSort: row.line_sort,
    fli: row.fli,
    lpr: row.lpr,
    peopleCounting: row.people_counting,
    fliCameraItemId: row.fli_camera_item_id ?? null,
    lprCameraItemId: row.lpr_camera_item_id ?? null,
    peopleCountingCameraItemId: row.people_counting_camera_item_id ?? null,
    entriesCount: Number(row.entries_count) || 0,
    exitsCount: Number(row.exits_count) || 0,
    levelsCount: Number(row.levels_count) || 0,
    images: (row.sales_quote_location_images ?? []).map(mapSalesQuoteLocationImageRow),
    signLines: items.filter((item) => item.lineType === "sign"),
    sensorLines: items.filter((item) => item.lineType === "sensor"),
    miscLines: items.filter((item) => item.lineType === "misc"),
    cameraLines: items.filter((item) => item.lineType === "camera"),
    vpuLines: items.filter((item) => item.lineType === "vpu"),
  };
}

function mapSalesQuoteBomLineRow(row: SalesQuoteBomLineRow): SalesQuoteBomLine {
  return {
    id: row.id,
    quoteId: row.quote_id,
    item: row.item_name,
    qty: Number(row.qty) || 0,
    notes: row.notes ?? "",
    catalogItemId: row.catalog_item_id ?? null,
    sourceLocationId: row.source_location_id ?? null,
  };
}

function mapSalesQuoteRow(row: SalesQuoteRow): SalesQuote {
  return {
    id: row.id,
    quoteRef: row.quote_ref ?? "",
    clientName: row.client_name,
    siteName: row.site_name,
    city: row.city ?? "",
    createdByEmail: row.created_by_email ?? "",
    createdAt: row.created_at,
    closedAt: row.closed_at ?? "",
    status: (row.status as SalesQuote["status"]) ?? "open",
    locations: (row.sales_quote_locations ?? [])
      .map(mapSalesQuoteLocationRow)
      .sort((a, b) => a.lineSort - b.lineSort),
    bomLines: (row.sales_quote_bom_lines ?? []).map(mapSalesQuoteBomLineRow),
    clientEmail: row.client_email ?? "",
    proposalSummary: row.proposal_summary ?? "",
    contactFullName: row.contact_full_name ?? "",
    contactPhone: row.contact_phone ?? "",
    preferredCommunication: row.preferred_communication ?? "",
    siteStreetAddress: row.site_street_address ?? "",
    siteState: row.site_state ?? "",
    siteZip: row.site_zip ?? "",
    clientStreetAddress: row.client_street_address ?? "",
    clientCity: row.client_city ?? "",
    clientState: row.client_state ?? "",
    clientZip: row.client_zip ?? "",
    saasType: row.saas_type ?? "",
    saasContractAmount: row.saas_contract_amount === null || row.saas_contract_amount === undefined ? null : Number(row.saas_contract_amount),
    saasBillingFrequency: (row.saas_billing_frequency as SalesQuote["saasBillingFrequency"]) ?? "",
    saleAmount: row.sale_amount === null || row.sale_amount === undefined ? null : Number(row.sale_amount),
  };
}

const SALES_QUOTE_SELECT =
  "id,quote_ref,client_name,site_name,city,created_by_email,created_at,closed_at,status,client_email,proposal_summary,contact_full_name,contact_phone,preferred_communication,site_street_address,site_state,site_zip,client_street_address,client_city,client_state,client_zip,saas_type,saas_contract_amount,saas_billing_frequency,sale_amount,sales_quote_locations(id,quote_id,location_type,name,address,line_sort,fli,lpr,people_counting,fli_camera_item_id,lpr_camera_item_id,people_counting_camera_item_id,entries_count,exits_count,levels_count,sales_quote_location_images(id,image_type,storage_path,file_name,description,uploaded_at,uploaded_by_email,photo_lat,photo_lng),sales_quote_location_items(id,quote_location_id,line_type,catalog_item_id,qty,line_sort,location_label,accessory_catalog_item_id,accessory_qty)),sales_quote_bom_lines(id,quote_id,item_name,qty,notes,line_sort,catalog_item_id,source_location_id)";

// Migration 088: soft-deleted quotes/locations/items/images/bom-lines
// filtered out here rather than dropped from the select, so
// fetchWithDeletedAtFallback can strip just these params if 088 hasn't
// run yet.
const SALES_QUOTE_DELETED_AT_FILTERS =
  "&deleted_at=is.null&sales_quote_locations.deleted_at=is.null&sales_quote_locations.sales_quote_location_images.deleted_at=is.null&sales_quote_locations.sales_quote_location_items.deleted_at=is.null&sales_quote_bom_lines.deleted_at=is.null";

export async function loadSalesQuotes(accessToken?: string): Promise<SalesQuote[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetchWithDeletedAtFallback(
    supabaseUrl(`sales_quotes?select=${SALES_QUOTE_SELECT}&order=created_at.desc${SALES_QUOTE_DELETED_AT_FILTERS}`),
    supabaseHeaders(accessToken),
  );
  if (!response.ok) {
    // Throw rather than silently returning [] -- this previously masked a
    // real failure (e.g. querying columns from a migration that hasn't
    // been run yet) as "no quotes exist", which looked exactly like data
    // loss even though nothing in the database had actually changed.
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Could not load sales quotes (${response.status}): ${errorBody || "unknown error"}`);
  }
  const rows = (await response.json()) as SalesQuoteRow[];
  return rows.map(mapSalesQuoteRow);
}

export async function createSalesQuote(
  input: {
    clientName: string;
    siteName: string;
    city: string;
    createdByEmail: string;
    garageCount: number;
    lotCount: number;
    clientEmail?: string;
    contactFullName?: string;
    contactPhone?: string;
    preferredCommunication?: string;
    siteStreetAddress?: string;
    siteState?: string;
    siteZip?: string;
    clientStreetAddress?: string;
    clientCity?: string;
    clientState?: string;
    clientZip?: string;
  },
  accessToken?: string,
): Promise<SalesQuote | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const quoteResponse = await fetch(supabaseUrl("sales_quotes"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      client_name: input.clientName,
      site_name: input.siteName,
      city: input.city || null,
      created_by_email: input.createdByEmail || null,
      client_email: input.clientEmail || null,
      contact_full_name: input.contactFullName || null,
      contact_phone: input.contactPhone || null,
      preferred_communication: input.preferredCommunication || null,
      site_street_address: input.siteStreetAddress || null,
      site_state: input.siteState || null,
      site_zip: input.siteZip || null,
      client_street_address: input.clientStreetAddress || null,
      client_city: input.clientCity || null,
      client_state: input.clientState || null,
      client_zip: input.clientZip || null,
    }),
  });
  if (!quoteResponse.ok) {
    throw new Error(`Could not save the quote: ${quoteResponse.status}`);
  }
  const quoteRows = (await quoteResponse.json()) as Array<{ id: string; quote_ref: string | null }>;
  const quoteId = quoteRows[0]?.id;
  if (!quoteId) {
    return null;
  }
  const quoteRef = quoteRows[0]?.quote_ref ?? "";

  const garageCount = Math.max(0, Math.floor(input.garageCount) || 0);
  const lotCount = Math.max(0, Math.floor(input.lotCount) || 0);
  const locationPayload: Array<Record<string, unknown>> = [];
  for (let index = 0; index < garageCount; index += 1) {
    locationPayload.push({ quote_id: quoteId, location_type: "garage", name: `Garage ${index + 1}`, line_sort: index });
  }
  for (let index = 0; index < lotCount; index += 1) {
    locationPayload.push({ quote_id: quoteId, location_type: "lot", name: `Lot ${index + 1}`, line_sort: garageCount + index });
  }

  let locationRows: SalesQuoteLocationRow[] = [];
  if (locationPayload.length > 0) {
    const locationResponse = await fetch(supabaseUrl("sales_quote_locations"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify(locationPayload),
    });
    if (locationResponse.ok) {
      locationRows = (await locationResponse.json()) as SalesQuoteLocationRow[];
    }
  }

  return {
    id: quoteId,
    quoteRef,
    clientName: input.clientName,
    siteName: input.siteName,
    city: input.city,
    createdByEmail: input.createdByEmail,
    createdAt: new Date().toISOString(),
    closedAt: "",
    status: "open",
    locations: locationRows.map((row) => mapSalesQuoteLocationRow({ ...row, sales_quote_location_images: [], sales_quote_location_items: [] })),
    bomLines: [],
    clientEmail: input.clientEmail ?? "",
    proposalSummary: "",
    contactFullName: input.contactFullName ?? "",
    contactPhone: input.contactPhone ?? "",
    preferredCommunication: input.preferredCommunication ?? "",
    siteStreetAddress: input.siteStreetAddress ?? "",
    siteState: input.siteState ?? "",
    siteZip: input.siteZip ?? "",
    clientStreetAddress: input.clientStreetAddress ?? "",
    clientCity: input.clientCity ?? "",
    clientState: input.clientState ?? "",
    clientZip: input.clientZip ?? "",
    saasType: "",
    saasContractAmount: null,
    saasBillingFrequency: "",
    saleAmount: null,
  };
}

export async function updateSalesQuoteStatus(id: string, status: SalesQuote["status"], closedAt: string | null, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const response = await fetch(supabaseUrl(`sales_quotes?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ status, closed_at: closedAt }),
  });
  if (!response.ok) {
    throw new Error(`Could not update quote status: ${response.status}`);
  }
  // A permissions-blocked PATCH still returns 200/204 with zero rows changed
  // -- Won/Lost drives Sales' Closed-This-Year and profit reporting, so a
  // status change that silently didn't take needs to be caught, not assumed.
  const rows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error("That status change didn't affect anything -- you may not have permission.");
  }
}

// Deletes the whole Site/Quote. All of its locations, location
// images/items, BOM lines, proposals, and intake responses cascade-delete
// with it (on delete cascade). Any tasks linked via quote_id just lose that
// link (on delete set null) -- their history is kept. If this quote was
// already converted to a Project, the Project keeps existing as its own
// record (projects.source_sales_quote_id also on delete set null).
export async function deleteSalesQuote(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`sales_quotes?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete sales quote") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("sales_quote", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

export type DeletedSalesQuote = {
  id: string;
  siteName: string;
  clientName: string;
  deletedByEmail: string;
  deletedAt: string;
};

type DeletedSalesQuoteRow = {
  id: string;
  site_name: string;
  client_name: string | null;
  deleted_by_email: string | null;
  deleted_at: string;
};

export async function loadDeletedSalesQuotes(accessToken?: string): Promise<DeletedSalesQuote[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(
    supabaseUrl("sales_quotes?select=id,site_name,client_name,deleted_by_email,deleted_at&deleted_at=not.is.null&order=deleted_at.desc"),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as DeletedSalesQuoteRow[];
  return rows.map((row) => ({
    id: row.id,
    siteName: row.site_name,
    clientName: row.client_name ?? "",
    deletedByEmail: row.deleted_by_email ?? "",
    deletedAt: row.deleted_at,
  }));
}

export async function restoreSalesQuote(id: string, label: string, actorEmail: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const response = await fetch(supabaseUrl(`sales_quotes?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: null, deleted_at: null }),
  });
  if (!response.ok) {
    return false;
  }
  const restoredRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (restoredRows.length === 0) {
    return false;
  }
  await logDeletionEvent("sales_quote", id, label, "restored", actorEmail, accessToken);
  return true;
}

// Migration 053: client email + proposal summary, edited from the Quote
// detail page's new "Create & Send Proposal" panel.
export async function updateSalesQuoteProposalFields(
  id: string,
  updates: Partial<{ clientEmail: string; proposalSummary: string }>,
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (updates.clientEmail !== undefined) payload.client_email = updates.clientEmail || null;
  if (updates.proposalSummary !== undefined) payload.proposal_summary = updates.proposalSummary || null;
  if (Object.keys(payload).length === 0) {
    return;
  }
  await fetch(supabaseUrl(`sales_quotes?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
}

// Bulk insert -- used both by the manual "add line" form and by the
// Pre-Sales Quick Estimate calculator pre-filling a quote's BOM in one shot.
export async function addSalesQuoteBomLines(
  quoteId: string,
  lines: Array<{ item: string; qty: number; notes?: string; catalogItemId?: string | null; sourceLocationId?: string | null }>,
  nextLineSort: number,
  accessToken?: string,
): Promise<SalesQuoteBomLine[]> {
  if (!isRemotePersistenceConfigured() || !accessToken || lines.length === 0) {
    return [];
  }
  const response = await fetch(supabaseUrl("sales_quote_bom_lines"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify(
      lines.map((line, index) => ({
        quote_id: quoteId,
        item_name: line.item,
        qty: line.qty,
        notes: line.notes || null,
        line_sort: nextLineSort + index,
        catalog_item_id: line.catalogItemId || null,
        source_location_id: line.sourceLocationId || null,
      })),
    ),
  });
  if (!response.ok) {
    throw new Error(`Could not add to the quote BOM: ${response.status}`);
  }
  const rows = (await response.json()) as SalesQuoteBomLineRow[];
  return rows.map(mapSalesQuoteBomLineRow);
}

// "Pull Location Hardware into Quote BOM" (main.tsx) is regenerate-safe --
// it calls this first to clear out only the lines IT previously created
// (source_location_id not null), leaving anything a rep typed in by hand
// at the quote level (source_location_id null) untouched, then re-adds
// fresh lines from the locations' current state via addSalesQuoteBomLines.
// Overnight audit (2026-09-11, task 2): this DELETE was completely
// unchecked. Verified safe to add a check here -- the one caller
// (handlePullLocationHardwareIntoQuoteBom) already wraps this AND the
// subsequent addSalesQuoteBomLines(...) insert in one try/catch with a
// real visible status message (setSalesQuoteStatus), so a throw here
// reaches the user. This check does NOT make the two-step delete-then-
// reinsert sequence atomic -- if this delete succeeds and the following
// insert then fails, the location-sourced BOM lines are still gone with
// nothing re-inserted (the same class of risk documented for
// saveProjectSites' BOM lines in PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md).
// This only makes the delete's own failure visible instead of silent; it
// does not close that separate, already-documented atomicity gap.
export async function deleteSalesQuoteBomLinesByLocationSource(quoteId: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const response = await fetch(supabaseUrl(`sales_quote_bom_lines?quote_id=eq.${quoteId}&source_location_id=not.is.null`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`deleteSalesQuoteBomLinesByLocationSource failed for quote ${quoteId} (${response.status}): ${bodyText}`);
    throw new Error("Could not update the Quote BOM.");
  }
}

export async function updateSalesQuoteBomLineCatalogLink(id: string, catalogItemId: string | null, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  // Overnight audit (2026-09-11, task 2): this PATCH was completely
  // unchecked. Safe to verify here -- the caller was given a small try/catch
  // reusing the existing setSalesQuoteStatus channel. This field is a
  // cosmetic/bookkeeping catalog link, not the BOM line's core content
  // (item/qty), which is checked separately.
  const response = await fetch(supabaseUrl(`sales_quote_bom_lines?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ catalog_item_id: catalogItemId }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateSalesQuoteBomLineCatalogLink failed for line ${id} (${response.status}): ${bodyText}`);
    throw new Error("Could not save this change.");
  }
  const rows = (await response.json().catch(() => [])) as unknown[];
  if (rows.length === 0) {
    console.error(`updateSalesQuoteBomLineCatalogLink affected 0 rows for line ${id} -- likely blocked by RLS or a missing line.`);
    throw new Error("Could not save this change.");
  }
}

export async function updateSalesQuoteBomLine(
  id: string,
  updates: { item: string; qty: number; notes: string; catalogItemId: string | null },
  accessToken?: string,
): Promise<SalesQuoteBomLine> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Could not save this BOM line.");
  }
  const item = updates.item.trim();
  if (!item || !Number.isFinite(updates.qty) || updates.qty <= 0) {
    throw new Error("Enter an item name and a quantity greater than zero.");
  }
  const response = await fetch(supabaseUrl(`sales_quote_bom_lines?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      item_name: item,
      qty: updates.qty,
      notes: updates.notes.trim() || null,
      catalog_item_id: updates.catalogItemId || null,
    }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateSalesQuoteBomLine failed for line ${id} (${response.status}): ${bodyText}`);
    throw new Error("Could not save this BOM line.");
  }
  const rows = (await response.json().catch(() => [])) as SalesQuoteBomLineRow[];
  if (rows.length !== 1) {
    console.error(`updateSalesQuoteBomLine affected ${rows.length} rows for line ${id}; expected exactly 1.`);
    throw new Error("Could not save this BOM line.");
  }
  return mapSalesQuoteBomLineRow(rows[0]);
}

export async function deleteSalesQuoteBomLine(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`sales_quote_bom_lines?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete BOM line") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("sales_quote_bom_line", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

export async function addSalesQuoteLocation(
  quoteId: string,
  locationType: "garage" | "lot",
  nextLineSort: number,
  accessToken?: string,
): Promise<SalesQuoteLocation | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const label = locationType === "garage" ? "Garage" : "Lot";
  const response = await fetch(supabaseUrl("sales_quote_locations"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ quote_id: quoteId, location_type: locationType, name: `${label} ${nextLineSort + 1}`, line_sort: nextLineSort }),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as SalesQuoteLocationRow[];
  return rows[0] ? mapSalesQuoteLocationRow({ ...rows[0], sales_quote_location_images: [], sales_quote_location_items: [] }) : null;
}

export async function updateSalesQuoteLocation(
  id: string,
  updates: Partial<{
    name: string;
    address: string;
    fli: boolean;
    lpr: boolean;
    peopleCounting: boolean;
    fliCameraItemId: string | null;
    lprCameraItemId: string | null;
    peopleCountingCameraItemId: string | null;
    entriesCount: number;
    exitsCount: number;
    levelsCount: number;
  }>,
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.address !== undefined) payload.address = updates.address;
  if (updates.fli !== undefined) payload.fli = updates.fli;
  if (updates.lpr !== undefined) payload.lpr = updates.lpr;
  if (updates.peopleCounting !== undefined) payload.people_counting = updates.peopleCounting;
  if (updates.fliCameraItemId !== undefined) payload.fli_camera_item_id = updates.fliCameraItemId;
  if (updates.lprCameraItemId !== undefined) payload.lpr_camera_item_id = updates.lprCameraItemId;
  if (updates.peopleCountingCameraItemId !== undefined) payload.people_counting_camera_item_id = updates.peopleCountingCameraItemId;
  if (updates.entriesCount !== undefined) payload.entries_count = updates.entriesCount;
  if (updates.exitsCount !== undefined) payload.exits_count = updates.exitsCount;
  if (updates.levelsCount !== undefined) payload.levels_count = updates.levelsCount;
  // Reviewed 2026-09-12 (overnight reliability closeout part 2, task 2):
  // logging-only, deliberately non-throwing -- the caller
  // (handleUpdateSalesQuoteLocation, main.tsx) updates local state
  // optimistically and awaits this call with no try/catch anywhere in
  // the chain down to the onChange handler; throwing would be a genuine
  // unhandled promise rejection. This only makes a real failure visible
  // in the console.
  const response = await fetch(supabaseUrl(`sales_quote_locations?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateSalesQuoteLocation: PATCH failed for location ${id} (${response.status}): ${bodyText}`);
  }
}

export async function deleteSalesQuoteLocation(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`sales_quote_locations?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete location") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("sales_quote_location", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

// Migration 056: addable Sign/Space Sensor/Misc lines at a location.
export async function addSalesQuoteLocationItem(
  quoteLocationId: string,
  lineType: SalesQuoteLocationItem["lineType"],
  catalogItemId: string,
  qty: number,
  lineSort: number,
  extra: { locationLabel?: string; accessoryCatalogItemId?: string | null; accessoryQty?: number } = {},
  accessToken?: string,
): Promise<SalesQuoteLocationItem | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const response = await fetch(supabaseUrl("sales_quote_location_items"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      quote_location_id: quoteLocationId,
      line_type: lineType,
      catalog_item_id: catalogItemId,
      qty,
      line_sort: lineSort,
      location_label: extra.locationLabel ?? "",
      accessory_catalog_item_id: extra.accessoryCatalogItemId ?? null,
      accessory_qty: extra.accessoryQty ?? 0,
    }),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as SalesQuoteLocationItemRow[];
  return rows[0] ? mapSalesQuoteLocationItemRow(rows[0]) : null;
}

export async function updateSalesQuoteLocationItem(
  id: string,
  updates: Partial<{ qty: number; locationLabel: string; accessoryCatalogItemId: string | null; accessoryQty: number }>,
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (updates.qty !== undefined) payload.qty = updates.qty;
  if (updates.locationLabel !== undefined) payload.location_label = updates.locationLabel;
  if (updates.accessoryCatalogItemId !== undefined) payload.accessory_catalog_item_id = updates.accessoryCatalogItemId;
  if (updates.accessoryQty !== undefined) payload.accessory_qty = updates.accessoryQty;
  // Reviewed 2026-09-12 (overnight reliability closeout part 2, task 2):
  // logging-only, deliberately non-throwing -- same reasoning as
  // updateSalesQuoteLocation above (fire-and-forget caller, no try/catch).
  const response = await fetch(supabaseUrl(`sales_quote_location_items?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateSalesQuoteLocationItem: PATCH failed for item ${id} (${response.status}): ${bodyText}`);
  }
}

export async function deleteSalesQuoteLocationItem(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`sales_quote_location_items?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete item") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("sales_quote_location_item", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

const SALES_QUOTE_IMAGE_BUCKET = "sales-quote-images";
const PROJECT_LOCATION_IMAGE_BUCKET = "project-location-images";

export function buildQuoteImageStoragePath(quoteLocationId: string, fileName: string): string {
  const stamp = Date.now().toString(36);
  return `${quoteLocationId}/${stamp}-${sanitizeStoragePathSegment(fileName)}`;
}

// Generic Storage REST upload, shared by the Sales quote-image bucket and
// the Project location-image bucket (same private-bucket-plus-user-JWT
// pattern for both).
async function uploadStorageObjectFile(bucket: string, file: File, storagePath: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  try {
    const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
    const response = await fetch(
      `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/${bucket}/${storagePath}`,
      {
        method: "POST",
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${accessToken}`,
          "content-type": file.type || "application/octet-stream",
          "x-upsert": "true",
        },
        body: file,
      },
    );
    if (!response.ok) {
      // A failed upload isn't always "offline" -- it can just as easily be
      // a missing/misnamed bucket, an RLS policy rejection, or a bad
      // request. Logging the real status/body means opening DevTools shows
      // the actual reason instead of everyone assuming "no connection."
      console.error("uploadStorageObjectFile failed", bucket, response.status, await response.text().catch(() => ""));
    }
    return response.ok;
  } catch (error) {
    // A rejected fetch can mean the device has no connection (common in a
    // parking garage), but it can also mean a CORS failure or other client
    // error -- log it either way so it's not a silent mystery.
    console.error("uploadStorageObjectFile threw", bucket, error);
    return false;
  }
}

// Server-side copy of a storage object -- used to clone a Sales Quote's
// photos/drawings into a Project's own bucket at conversion time, so each
// side owns an independent object it can delete without touching the
// other's copy (no download+reupload round trip needed).
async function copyStorageObject(sourceBucket: string, sourceKey: string, destinationBucket: string, destinationKey: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  try {
    const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
    const response = await fetch(`${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/copy`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ bucketId: sourceBucket, sourceKey, destinationKey, destinationBucket }),
    });
    if (!response.ok) {
      console.error("copyStorageObject failed", sourceBucket, "->", destinationBucket, response.status, await response.text().catch(() => ""));
    }
    return response.ok;
  } catch (error) {
    console.error("copyStorageObject threw", error);
    return false;
  }
}

export async function uploadQuoteImageFile(file: File, storagePath: string, accessToken?: string): Promise<boolean> {
  return uploadStorageObjectFile(SALES_QUOTE_IMAGE_BUCKET, file, storagePath, accessToken);
}

async function getStorageObjectSignedUrl(bucket: string, storagePath: string, accessToken?: string): Promise<string | null> {
  if (!isRemotePersistenceConfigured() || !accessToken || !storagePath) {
    return null;
  }
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
  const response = await fetch(
    `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/sign/${bucket}/${storagePath}`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    },
  );
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { signedURL?: string };
  if (!body.signedURL) {
    return null;
  }
  return `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1${body.signedURL}`;
}

export async function getQuoteImageDownloadUrl(storagePath: string, accessToken?: string): Promise<string | null> {
  return getStorageObjectSignedUrl(SALES_QUOTE_IMAGE_BUCKET, storagePath, accessToken);
}

export async function getProjectLocationImageDownloadUrl(storagePath: string, accessToken?: string): Promise<string | null> {
  return getStorageObjectSignedUrl(PROJECT_LOCATION_IMAGE_BUCKET, storagePath, accessToken);
}

export async function addSalesQuoteLocationImage(
  quoteLocationId: string,
  imageType: "photo" | "drawing",
  file: File,
  accessToken?: string,
  description?: string,
  uploaderEmail?: string,
  coords?: { lat: number; lng: number } | null,
): Promise<SalesQuoteLocationImage | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  try {
    const storagePath = buildQuoteImageStoragePath(quoteLocationId, file.name);
    const uploaded = await uploadStorageObjectFile(SALES_QUOTE_IMAGE_BUCKET, file, storagePath, accessToken);
    if (!uploaded) {
      return null;
    }
    const response = await fetch(supabaseUrl("sales_quote_location_images"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify({
        quote_location_id: quoteLocationId,
        image_type: imageType,
        storage_path: storagePath,
        file_name: file.name,
        description: description || null,
        uploaded_by_email: uploaderEmail || null,
        photo_lat: coords?.lat ?? null,
        photo_lng: coords?.lng ?? null,
      }),
    });
    if (!response.ok) {
      console.error("addSalesQuoteLocationImage insert failed", response.status, await response.text().catch(() => ""));
      return null;
    }
    const rows = (await response.json()) as SalesQuoteLocationImageRow[];
    return rows[0] ? mapSalesQuoteLocationImageRow(rows[0]) : null;
  } catch (error) {
    console.error("addSalesQuoteLocationImage threw", error);
    // Network failure (offline) -- same as above, treat as "not uploaded"
    // rather than an uncaught rejection so the offline photo queue can
    // retry later instead of the save silently crashing.
    return null;
  }
}

// --- Offline photo queue (IndexedDB) ---------------------------------------
// Field reps take Site Builder photos inside parking garages/structures,
// where cell signal is often weak or nonexistent. If an upload attempt
// fails because the device has no connection, an in-memory-only retry queue
// would vanish the moment the tab closes or the phone locks -- IndexedDB
// survives both, so a captured photo is durable the instant it's queued.
// main.tsx's App component flushes this queue automatically (on load, on
// the browser's `online` event, and on an interval) using the same
// addSalesQuoteLocationImage upload path above.
const PENDING_PHOTO_DB_NAME = "ergon_offline_photos";
const PENDING_PHOTO_STORE = "pending_photos";
const PENDING_PHOTO_DB_VERSION = 1;

export type PendingSitePhoto = {
  id: string;
  // "quoteId" is really just "owner id" (a Sales quote id, a Project ref,
  // or -- once ownerType is "shipment" -- a Project ref too, since a
  // shipment photo's real parent is the shipment itself) -- kept as
  // quoteId for backward compatibility with photos already queued in a
  // device's IndexedDB before Projects got their own camera capture.
  quoteId: string;
  // "locationId" doubles as shipmentId when ownerType is "shipment" --
  // same reasoning as quoteId above, avoids a schema bump for a field
  // that's really just "the second half of the owner key."
  locationId: string;
  fileName: string;
  fileType: string;
  description: string;
  blob: Blob;
  createdAt: string;
  // Missing/undefined on anything queued before this field existed --
  // treat as "quote" (the only owner type that existed then).
  ownerType?: "quote" | "project" | "shipment" | "purchase_order";
  uploaderEmail?: string;
  lat?: number | null;
  lng?: number | null;
};

function openPendingPhotoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }
    const request = indexedDB.open(PENDING_PHOTO_DB_NAME, PENDING_PHOTO_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PENDING_PHOTO_STORE)) {
        db.createObjectStore(PENDING_PHOTO_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queuePendingSitePhoto(entry: Omit<PendingSitePhoto, "id" | "createdAt">): Promise<void> {
  try {
    const db = await openPendingPhotoDb();
    const record: PendingSitePhoto = {
      ...entry,
      id: `pending_photo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      createdAt: new Date().toISOString(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PENDING_PHOTO_STORE, "readwrite");
      tx.objectStore(PENDING_PHOTO_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // If IndexedDB itself is unavailable (very old browser, private mode
    // restrictions, etc.) there's nowhere safe left to stash the photo --
    // the caller already surfaces a "could not be saved" message either way.
  }
}

export async function listPendingSitePhotos(): Promise<PendingSitePhoto[]> {
  try {
    const db = await openPendingPhotoDb();
    const records = await new Promise<PendingSitePhoto[]>((resolve, reject) => {
      const tx = db.transaction(PENDING_PHOTO_STORE, "readonly");
      const request = tx.objectStore(PENDING_PHOTO_STORE).getAll();
      request.onsuccess = () => resolve(request.result as PendingSitePhoto[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return records;
  } catch {
    return [];
  }
}

export async function removePendingSitePhoto(id: string): Promise<void> {
  try {
    const db = await openPendingPhotoDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PENDING_PHOTO_STORE, "readwrite");
      tx.objectStore(PENDING_PHOTO_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // best-effort cleanup only
  }
}

// Reviewed 2026-09-12 (overnight reliability closeout part 2, task 2):
// logging-only addition to all three functions below -- each already
// returns its real response.ok to the caller (unlike the fire-and-forget
// group above, these booleans DO propagate), so this only adds the
// missing diagnostic detail on a failure; the existing boolean-based
// caller contracts are unchanged.
export async function updateSalesQuoteLocationImageDescription(imageId: string, description: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const response = await fetch(supabaseUrl(`sales_quote_location_images?id=eq.${imageId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ description: description || null }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateSalesQuoteLocationImageDescription: PATCH failed for image ${imageId} (${response.status}): ${bodyText}`);
  }
  return response.ok;
}

export async function updateSalesQuoteLocationImageMeta(
  imageId: string,
  updates: Partial<{ fileName: string; description: string }>,
  accessToken?: string,
): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const payload: Record<string, string | null> = {};
  if (updates.fileName !== undefined) payload.file_name = updates.fileName.trim() || null;
  if (updates.description !== undefined) payload.description = updates.description.trim() || null;
  if (Object.keys(payload).length === 0) {
    return true;
  }
  const response = await fetch(supabaseUrl(`sales_quote_location_images?id=eq.${imageId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateSalesQuoteLocationImageMeta: PATCH failed for image ${imageId} (${response.status}): ${bodyText}`);
  }
  return response.ok;
}

export async function moveSalesQuoteLocationImage(imageId: string, targetLocationId: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken || !targetLocationId) {
    return false;
  }
  const response = await fetch(supabaseUrl(`sales_quote_location_images?id=eq.${imageId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ quote_location_id: targetLocationId }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`moveSalesQuoteLocationImage: PATCH failed for image ${imageId} (${response.status}): ${bodyText}`);
  }
  return response.ok;
}

// Migration 088: soft delete only, Storage object left in place -- same
// reasoning as deleteProjectLocationImage below.
export async function deleteSalesQuoteLocationImage(imageId: string, _storagePath: string, label: string, actorEmail: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  try {
    const response = await fetch(supabaseUrl(`sales_quote_location_images?id=eq.${imageId}`), {
      method: "PATCH",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
    });
    if (!response.ok) {
      return false;
    }
    const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
    if (deletedRows.length === 0) {
      return false;
    }
    await logDeletionEvent("sales_quote_location_image", imageId, label, "deleted", actorEmail, accessToken);
    return true;
  } catch (error) {
    console.error("deleteSalesQuoteLocationImage threw", error);
    return false;
  }
}

export type DeletedSalesQuoteImage = {
  id: string;
  quoteLocationId: string;
  siteName: string;
  locationName: string;
  fileName: string;
  storagePath: string;
  imageType: "photo" | "drawing";
  deletedByEmail: string;
  deletedAt: string;
};

type DeletedSalesQuoteImageRow = {
  id: string;
  quote_location_id: string;
  file_name: string | null;
  storage_path: string;
  image_type: string;
  deleted_by_email: string | null;
  deleted_at: string;
  sales_quote_locations: { name: string; sales_quotes: { site_name: string } | { site_name: string }[] | null } | { name: string; sales_quotes: { site_name: string } | { site_name: string }[] | null }[] | null;
};

export async function loadDeletedSalesQuoteImages(accessToken?: string): Promise<DeletedSalesQuoteImage[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(
    supabaseUrl(
      "sales_quote_location_images?select=id,quote_location_id,file_name,storage_path,image_type,deleted_by_email,deleted_at,sales_quote_locations(name,sales_quotes(site_name))&deleted_at=not.is.null&order=deleted_at.desc",
    ),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as DeletedSalesQuoteImageRow[];
  return rows.map((row) => {
    const location = Array.isArray(row.sales_quote_locations) ? row.sales_quote_locations[0] : row.sales_quote_locations;
    const quote = location ? (Array.isArray(location.sales_quotes) ? location.sales_quotes[0] : location.sales_quotes) : null;
    return {
      id: row.id,
      quoteLocationId: row.quote_location_id,
      siteName: quote?.site_name ?? "Unknown quote",
      locationName: location?.name ?? "Unknown location",
      fileName: row.file_name ?? "Untitled",
      storagePath: row.storage_path,
      imageType: row.image_type === "drawing" ? "drawing" : "photo",
      deletedByEmail: row.deleted_by_email ?? "",
      deletedAt: row.deleted_at,
    };
  });
}

export async function restoreSalesQuoteLocationImage(imageId: string, label: string, actorEmail: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const response = await fetch(supabaseUrl(`sales_quote_location_images?id=eq.${imageId}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: null, deleted_at: null }),
  });
  if (!response.ok) {
    return false;
  }
  const restoredRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (restoredRows.length === 0) {
    return false;
  }
  await logDeletionEvent("sales_quote_location_image", imageId, label, "restored", actorEmail, accessToken);
  return true;
}

// --- Project Locations -------------------------------------------------
// Mirror of the Sales Quote location/image/item functions above, one-to-one,
// so Projects get the exact same per-garage/lot photo+drawing+hardware
// breakdown -- both a brand-new project can build its own from scratch, and
// createProjectFromClosedWonQuote (below) can populate one from a quote.

export async function addProjectLocation(
  projectId: string,
  locationType: "garage" | "lot",
  nextLineSort: number,
  accessToken?: string,
): Promise<ProjectLocation | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const label = locationType === "garage" ? "Garage" : "Lot";
  const response = await fetch(supabaseUrl("project_locations"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ project_id: projectId, location_type: locationType, name: `${label} ${nextLineSort + 1}`, line_sort: nextLineSort }),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as ProjectLocationRow[];
  return rows[0] ? mapProjectLocationRow({ ...rows[0], project_location_images: [], project_location_items: [] }) : null;
}

export async function updateProjectLocation(
  id: string,
  updates: Partial<{
    name: string;
    address: string;
    fli: boolean;
    lpr: boolean;
    peopleCounting: boolean;
    fliCameraItemId: string | null;
    lprCameraItemId: string | null;
    peopleCountingCameraItemId: string | null;
    entriesCount: number;
    exitsCount: number;
    levelsCount: number;
  }>,
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.address !== undefined) payload.address = updates.address;
  if (updates.fli !== undefined) payload.fli = updates.fli;
  if (updates.lpr !== undefined) payload.lpr = updates.lpr;
  if (updates.peopleCounting !== undefined) payload.people_counting = updates.peopleCounting;
  if (updates.fliCameraItemId !== undefined) payload.fli_camera_item_id = updates.fliCameraItemId;
  if (updates.lprCameraItemId !== undefined) payload.lpr_camera_item_id = updates.lprCameraItemId;
  if (updates.peopleCountingCameraItemId !== undefined) payload.people_counting_camera_item_id = updates.peopleCountingCameraItemId;
  if (updates.entriesCount !== undefined) payload.entries_count = updates.entriesCount;
  if (updates.exitsCount !== undefined) payload.exits_count = updates.exitsCount;
  if (updates.levelsCount !== undefined) payload.levels_count = updates.levelsCount;
  if (Object.keys(payload).length === 0) {
    return;
  }
  // Reviewed 2026-09-12 (overnight reliability closeout part 2, task 2):
  // logging-only, deliberately non-throwing -- same reasoning as
  // updateSalesQuoteLocation (its mirror function, per this file's own
  // comment above updateProjectLocation's original definition): the
  // caller is fire-and-forget with no try/catch.
  const response = await fetch(supabaseUrl(`project_locations?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateProjectLocation: PATCH failed for location ${id} (${response.status}): ${bodyText}`);
  }
}

export async function deleteProjectLocation(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`project_locations?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete location") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("project_location", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

export type DeletedProjectLocation = {
  id: string;
  projectId: string;
  projectName: string;
  locationName: string;
  locationType: "garage" | "lot";
  deletedByEmail: string;
  deletedAt: string;
};

type DeletedProjectLocationRow = {
  id: string;
  project_id: string;
  name: string;
  location_type: string;
  deleted_by_email: string | null;
  deleted_at: string;
  projects: { project_name: string } | { project_name: string }[] | null;
};

export async function loadDeletedProjectLocations(accessToken?: string): Promise<DeletedProjectLocation[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(
    supabaseUrl("project_locations?select=id,project_id,name,location_type,deleted_by_email,deleted_at,projects(project_name)&deleted_at=not.is.null&order=deleted_at.desc"),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as DeletedProjectLocationRow[];
  return rows.map((row) => {
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    return {
      id: row.id,
      projectId: row.project_id,
      projectName: project?.project_name ?? "Unknown project",
      locationName: row.name,
      locationType: row.location_type === "lot" ? "lot" : "garage",
      deletedByEmail: row.deleted_by_email ?? "",
      deletedAt: row.deleted_at,
    };
  });
}

export async function restoreProjectLocation(id: string, label: string, actorEmail: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const response = await fetch(supabaseUrl(`project_locations?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ deleted_by_email: null, deleted_at: null }),
  });
  if (response.ok) {
    await logDeletionEvent("project_location", id, label, "restored", actorEmail, accessToken);
  }
  return response.ok;
}

export async function addProjectLocationItem(
  projectLocationId: string,
  lineType: ProjectLocationItem["lineType"],
  catalogItemId: string,
  qty: number,
  lineSort: number,
  extra: { locationLabel?: string; accessoryCatalogItemId?: string | null; accessoryQty?: number } = {},
  accessToken?: string,
): Promise<ProjectLocationItem | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const response = await fetch(supabaseUrl("project_location_items"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      project_location_id: projectLocationId,
      line_type: lineType,
      catalog_item_id: catalogItemId,
      qty,
      line_sort: lineSort,
      location_label: extra.locationLabel ?? "",
      accessory_catalog_item_id: extra.accessoryCatalogItemId ?? null,
      accessory_qty: extra.accessoryQty ?? 0,
    }),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as ProjectLocationItemRow[];
  return rows[0] ? mapProjectLocationItemRow(rows[0]) : null;
}

export async function updateProjectLocationItem(
  id: string,
  updates: Partial<{ qty: number; locationLabel: string; accessoryCatalogItemId: string | null; accessoryQty: number }>,
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (updates.qty !== undefined) payload.qty = updates.qty;
  if (updates.locationLabel !== undefined) payload.location_label = updates.locationLabel;
  if (updates.accessoryCatalogItemId !== undefined) payload.accessory_catalog_item_id = updates.accessoryCatalogItemId;
  if (updates.accessoryQty !== undefined) payload.accessory_qty = updates.accessoryQty;
  // Reviewed 2026-09-12 (overnight reliability closeout part 2, task 2):
  // logging-only, deliberately non-throwing -- same reasoning as
  // updateSalesQuoteLocationItem (its mirror function): fire-and-forget
  // caller, no try/catch.
  const response = await fetch(supabaseUrl(`project_location_items?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateProjectLocationItem: PATCH failed for item ${id} (${response.status}): ${bodyText}`);
  }
}

export async function deleteProjectLocationItem(id: string, label: string, actorEmail: string, accessToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, error: "Not configured." };
  }
  const response = await fetch(supabaseUrl(`project_location_items?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    return { ok: false, error: await readSupabaseError(response, "Could not delete item") };
  }
  const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (deletedRows.length === 0) {
    return { ok: false, error: "Delete didn't affect anything -- you may not have permission." };
  }
  await logDeletionEvent("project_location_item", id, label, "deleted", actorEmail, accessToken);
  return { ok: true };
}

export function buildProjectImageStoragePath(projectLocationId: string, fileName: string): string {
  const stamp = Date.now().toString(36);
  return `${projectLocationId}/${stamp}-${sanitizeStoragePathSegment(fileName)}`;
}

export async function addProjectLocationImage(
  projectLocationId: string,
  imageType: "photo" | "drawing",
  file: File,
  accessToken?: string,
  description?: string,
  uploaderEmail?: string,
  coords?: { lat: number; lng: number } | null,
): Promise<ProjectLocationImage | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  try {
    const storagePath = buildProjectImageStoragePath(projectLocationId, file.name);
    const uploaded = await uploadStorageObjectFile(PROJECT_LOCATION_IMAGE_BUCKET, file, storagePath, accessToken);
    if (!uploaded) {
      return null;
    }
    const response = await fetch(supabaseUrl("project_location_images"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify({
        project_location_id: projectLocationId,
        image_type: imageType,
        storage_path: storagePath,
        file_name: file.name,
        description: description || null,
        uploaded_by_email: uploaderEmail || null,
        photo_lat: coords?.lat ?? null,
        photo_lng: coords?.lng ?? null,
      }),
    });
    if (!response.ok) {
      console.error("addProjectLocationImage insert failed", response.status, await response.text().catch(() => ""));
      return null;
    }
    const rows = (await response.json()) as ProjectLocationImageRow[];
    return rows[0] ? mapProjectLocationImageRow(rows[0]) : null;
  } catch (error) {
    console.error("addProjectLocationImage threw", error);
    return null;
  }
}

export async function updateProjectLocationImageDescription(imageId: string, description: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const response = await fetch(supabaseUrl(`project_location_images?id=eq.${imageId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ description: description || null }),
  });
  return response.ok;
}

export async function updateProjectLocationImageMeta(
  imageId: string,
  updates: Partial<{ fileName: string; description: string }>,
  accessToken?: string,
): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const payload: Record<string, string | null> = {};
  if (updates.fileName !== undefined) payload.file_name = updates.fileName.trim() || null;
  if (updates.description !== undefined) payload.description = updates.description.trim() || null;
  if (Object.keys(payload).length === 0) {
    return true;
  }
  const response = await fetch(supabaseUrl(`project_location_images?id=eq.${imageId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  return response.ok;
}

export async function moveProjectLocationImage(imageId: string, targetLocationId: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken || !targetLocationId) {
    return false;
  }
  const response = await fetch(supabaseUrl(`project_location_images?id=eq.${imageId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ project_location_id: targetLocationId }),
  });
  return response.ok;
}

// Migration 088: soft delete only now -- the Storage object is deliberately
// left in place so a restored photo isn't just an empty DB row pointing at
// nothing. This was the audit's highest-severity finding: a deleted site
// photo used to be genuinely unrecoverable evidence, not just a lost row.
export async function deleteProjectLocationImage(imageId: string, _storagePath: string, label: string, actorEmail: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  try {
    const response = await fetch(supabaseUrl(`project_location_images?id=eq.${imageId}`), {
      method: "PATCH",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
    });
    if (!response.ok) {
      return false;
    }
    const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
    if (deletedRows.length === 0) {
      return false;
    }
    await logDeletionEvent("project_location_image", imageId, label, "deleted", actorEmail, accessToken);
    return true;
  } catch (error) {
    console.error("deleteProjectLocationImage threw", error);
    return false;
  }
}

export type DeletedProjectLocationImage = {
  id: string;
  projectLocationId: string;
  projectName: string;
  locationName: string;
  fileName: string;
  storagePath: string;
  imageType: "photo" | "drawing";
  deletedByEmail: string;
  deletedAt: string;
};

type DeletedProjectLocationImageRow = {
  id: string;
  project_location_id: string;
  file_name: string | null;
  storage_path: string;
  image_type: string;
  deleted_by_email: string | null;
  deleted_at: string;
  project_locations: { name: string; projects: { project_name: string } | { project_name: string }[] | null } | { name: string; projects: { project_name: string } | { project_name: string }[] | null }[] | null;
};

export async function loadDeletedProjectLocationImages(accessToken?: string): Promise<DeletedProjectLocationImage[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(
    supabaseUrl(
      "project_location_images?select=id,project_location_id,file_name,storage_path,image_type,deleted_by_email,deleted_at,project_locations(name,projects(project_name))&deleted_at=not.is.null&order=deleted_at.desc",
    ),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as DeletedProjectLocationImageRow[];
  return rows.map((row) => {
    const location = Array.isArray(row.project_locations) ? row.project_locations[0] : row.project_locations;
    const project = location ? (Array.isArray(location.projects) ? location.projects[0] : location.projects) : null;
    return {
      id: row.id,
      projectLocationId: row.project_location_id,
      projectName: project?.project_name ?? "Unknown project",
      locationName: location?.name ?? "Unknown location",
      fileName: row.file_name ?? "Untitled",
      storagePath: row.storage_path,
      imageType: row.image_type === "drawing" ? "drawing" : "photo",
      deletedByEmail: row.deleted_by_email ?? "",
      deletedAt: row.deleted_at,
    };
  });
}

export async function restoreProjectLocationImage(imageId: string, label: string, actorEmail: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const response = await fetch(supabaseUrl(`project_location_images?id=eq.${imageId}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ deleted_by_email: null, deleted_at: null }),
  });
  if (!response.ok) {
    return false;
  }
  const restoredRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
  if (restoredRows.length === 0) {
    return false;
  }
  await logDeletionEvent("project_location_image", imageId, label, "restored", actorEmail, accessToken);
  return true;
}

export async function addProjectShippingAddress(
  projectId: string,
  address: { label: string; streetAddress: string; city: string; state: string; zip: string; attnName: string; phone: string; homePhone?: string; cellPhone?: string; workPhone?: string },
  lineSort: number,
  accessToken?: string,
): Promise<ProjectShippingAddress | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const response = await fetch(supabaseUrl("project_shipping_addresses"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      project_id: projectId,
      label: address.label,
      street_address: address.streetAddress,
      city: address.city,
      state: address.state,
      zip: address.zip,
      attn_name: address.attnName,
      phone: address.phone,
      home_phone: address.homePhone || null,
      cell_phone: address.cellPhone || null,
      work_phone: address.workPhone || null,
      line_sort: lineSort,
    }),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as ProjectShippingAddressRow[];
  return rows[0] ? mapProjectShippingAddressRow(rows[0]) : null;
}

export async function addProjectShipment(
  projectId: string,
  shipmentNumber: string,
  addressId: string | null,
  addressSnapshot: string,
  requestedByEmail: string,
  notes: string,
  lines: Array<{ itemName: string; qty: number }>,
  accessToken?: string,
): Promise<ProjectShipment | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const response = await fetch(supabaseUrl("project_shipments"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      project_id: projectId,
      shipment_number: shipmentNumber,
      address_id: addressId,
      address_snapshot: addressSnapshot,
      requested_by_email: requestedByEmail,
      notes,
    }),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as ProjectShipmentRow[];
  const created = rows[0];
  if (!created) {
    return null;
  }
  if (lines.length > 0) {
    const linesResponse = await fetch(supabaseUrl("project_shipment_lines"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify(
        lines.map((line, index) => ({
          shipment_id: created.id,
          item_name: line.itemName,
          qty: line.qty,
          line_sort: index,
        })),
      ),
    });
    created.project_shipment_lines = linesResponse.ok ? ((await linesResponse.json()) as ProjectShipmentLineRow[]) : [];
  }
  created.project_shipment_photos = [];
  return mapProjectShipmentRow(created);
}

export async function updateProjectShipment(
  id: string,
  updates: Partial<{
    status: ProjectShipment["status"];
    packedByEmail: string;
    packedAt: string;
    carrier: string;
    trackingNumber: string;
    shippedByEmail: string;
    shippedAt: string;
    notes: string;
  }>,
  accessToken?: string,
): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const payload: Record<string, unknown> = {};
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.packedByEmail !== undefined) payload.packed_by_email = updates.packedByEmail;
  if (updates.packedAt !== undefined) payload.packed_at = updates.packedAt;
  if (updates.carrier !== undefined) payload.carrier = updates.carrier;
  if (updates.trackingNumber !== undefined) payload.tracking_number = updates.trackingNumber;
  if (updates.shippedByEmail !== undefined) payload.shipped_by_email = updates.shippedByEmail;
  if (updates.shippedAt !== undefined) payload.shipped_at = updates.shippedAt;
  if (updates.notes !== undefined) payload.notes = updates.notes;
  const response = await fetch(supabaseUrl(`project_shipments?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  return response.ok;
}

const PROJECT_SHIPMENT_PHOTO_BUCKET = "project-shipment-photos";

export function buildShipmentPhotoStoragePath(shipmentId: string, fileName: string): string {
  const stamp = Date.now().toString(36);
  return `${shipmentId}/${stamp}-${sanitizeStoragePathSegment(fileName)}`;
}

export async function uploadShipmentPhotoFile(file: File, storagePath: string, accessToken?: string): Promise<boolean> {
  return uploadStorageObjectFile(PROJECT_SHIPMENT_PHOTO_BUCKET, file, storagePath, accessToken);
}

export async function getShipmentPhotoDownloadUrl(storagePath: string, accessToken?: string): Promise<string | null> {
  return getStorageObjectSignedUrl(PROJECT_SHIPMENT_PHOTO_BUCKET, storagePath, accessToken);
}

export async function addProjectShipmentPhoto(
  shipmentId: string,
  file: File,
  accessToken?: string,
  description?: string,
  uploaderEmail?: string,
): Promise<ProjectShipmentPhoto | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  try {
    const storagePath = buildShipmentPhotoStoragePath(shipmentId, file.name);
    const uploaded = await uploadShipmentPhotoFile(file, storagePath, accessToken);
    if (!uploaded) {
      return null;
    }
    const response = await fetch(supabaseUrl("project_shipment_photos"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify({
        shipment_id: shipmentId,
        storage_path: storagePath,
        file_name: file.name,
        description: description || null,
        uploaded_by_email: uploaderEmail || null,
      }),
    });
    if (!response.ok) {
      console.error("addProjectShipmentPhoto insert failed", response.status, await response.text().catch(() => ""));
      return null;
    }
    const rows = (await response.json()) as ProjectShipmentPhotoRow[];
    return rows[0] ? mapProjectShipmentPhotoRow(rows[0]) : null;
  } catch (error) {
    console.error("addProjectShipmentPhoto threw", error);
    return null;
  }
}

// Migration 088: soft delete only -- Storage object left in place. No
// restore UI yet (lower priority than location photos per the audit), but
// the row and file both survive and every delete is logged, so nothing is
// actually lost even without a button for it today.
export async function deleteProjectShipmentPhoto(photoId: string, label: string, actorEmail: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  try {
    const response = await fetch(supabaseUrl(`project_shipment_photos?id=eq.${photoId}`), {
      method: "PATCH",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify({ deleted_by_email: actorEmail || null, deleted_at: new Date().toISOString() }),
    });
    if (!response.ok) {
      return false;
    }
    const deletedRows = (await response.json().catch(() => [])) as Array<{ id: string }>;
    if (deletedRows.length === 0) {
      return false;
    }
    await logDeletionEvent("project_shipment_photo", photoId, label, "deleted", actorEmail, accessToken);
    return true;
  } catch (error) {
    console.error("deleteProjectShipmentPhoto threw", error);
    return false;
  }
}

export type ProjectConversionPhotoFailure = {
  locationName: string;
  fileName: string;
  reason: string;
};

// Stable, matches the RPC's own EC00x SQLSTATEs (migration 127) --
// "unknown" covers a network failure or any error the RPC didn't tag with
// one of those codes, which get a generic, safe fallback message rather
// than whatever raw text came back.
export type ProjectConversionFailureReason =
  | "not_authorized"
  | "wrong_workspace"
  | "quote_not_found"
  | "not_closed_won"
  | "name_collision"
  | "conversion_in_progress"
  | "workspace_unavailable"
  | "unknown";

export type ProjectConversionFailure = {
  ok: false;
  reason: ProjectConversionFailureReason;
  message: string;
};

export type ProjectConversionSuccess = {
  ok: true;
  project: ProjectSite;
  alreadyExisted: boolean;
  // False for any project this function didn't itself create (or
  // previously create) in one atomic transaction -- most commonly a
  // project made by the pre-127 client-side code. Never inferred from row
  // counts, which can't tell "always had 3 BOM lines" from "used to have
  // 5, 2 silently failed to copy" -- see migration 127's own comment.
  structureVerified: boolean;
  bomLineCount: number;
  locationCount: number;
  locationItemCount: number;
  totalPhotos: number;
  copiedPhotos: number;
  alreadyCopiedPhotos: number;
  failedPhotos: ProjectConversionPhotoFailure[];
};

export type ProjectConversionOutcome = ProjectConversionSuccess | ProjectConversionFailure;

type CreateProjectFromQuoteRpcResult = {
  project_id: string;
  already_existed: boolean;
  structure_verified: boolean;
  bom_line_count: number;
  location_count: number;
  location_item_count: number;
  locations: Array<{
    quote_location_id: string;
    project_location_id: string;
    already_copied_quote_image_ids: string[];
  }>;
};

const PROJECT_CONVERSION_ERROR_CODE_REASONS: Record<string, ProjectConversionFailureReason> = {
  EC001: "not_authorized",
  EC002: "wrong_workspace",
  EC003: "quote_not_found",
  EC004: "not_closed_won",
  EC005: "name_collision",
  EC006: "conversion_in_progress",
  EC007: "workspace_unavailable",
};

const GENERIC_PROJECT_CONVERSION_FAILURE_MESSAGE =
  "Could not create the project -- check your connection and that you're signed in, then try Create Project again. If it keeps happening, check the browser console for details.";

async function readProjectConversionRpcFailure(response: Response): Promise<ProjectConversionFailure> {
  const body = (await response.json().catch(() => ({}))) as { code?: unknown; message?: unknown };
  const code = typeof body.code === "string" ? body.code : null;
  const message = typeof body.message === "string" && body.message ? body.message : null;
  console.error("createProjectFromClosedWonQuote: create_project_from_quote RPC failed", response.status, code, message);
  const reason = code ? PROJECT_CONVERSION_ERROR_CODE_REASONS[code] : undefined;
  // Only ever surface the RPC's own message when it's one of the specific,
  // known-safe codes migration 127 raises -- an unrecognized code or a
  // network-level failure falls back to the same generic message this
  // function has always shown, rather than risking an internal detail
  // (a raw constraint name, a stack fragment) reaching the user.
  if (reason && message) {
    return { ok: false, reason, message };
  }
  return { ok: false, reason: "unknown", message: GENERIC_PROJECT_CONVERSION_FAILURE_MESSAGE };
}

// Best-effort cleanup after a photo's storage object was copied but its
// database row could not be saved (a real failure, or another concurrent
// retry winning the uniqueness race) -- otherwise that copy is orphaned in
// Storage forever, referenced by nothing. Does its own fetch (there was a
// shared deleteStorageObject() helper, but it turned out to already have
// zero real call sites -- deleted as dead code rather than resurrected,
// since it swallowed network errors and never checked response.ok, exactly
// the failure to actually verify/log cleanup this function exists to fix)
// so a failed cleanup is genuinely inspected and logged (status + body on
// a non-2xx response, the error itself on a network failure) -- never
// thrown, so a cleanup failure can never turn a reported photo failure
// into a worse, unhandled one.
async function cleanupOrphanedProjectLocationImage(destinationPath: string, accessToken: string) {
  try {
    const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
    const response = await fetch(
      `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/${PROJECT_LOCATION_IMAGE_BUCKET}/${destinationPath}`,
      { method: "DELETE", headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("createProjectFromClosedWonQuote: failed to clean up an orphaned storage object", destinationPath, response.status, body);
    }
  } catch (error) {
    console.error("createProjectFromClosedWonQuote: failed to clean up an orphaned storage object (network error)", destinationPath, error);
  }
}

// "Create Project" from a Closed - Won Sales Quote -- E's request: closing a
// deal should offer to spin up a Project that starts with everything the
// quote already has (contact/address info, BOM, and the full per-garage/lot
// breakdown including photos/drawings), in the same format, so media can be
// tracked from presale through implementation to closeout. One-time copy
// (same "copy on link" shape as the older "Pull BOM from Closed Sales"): the
// two stay independent after this runs.
//
// Migration 127 moved the project/scope-of-work/BOM-lines/locations/
// location-items writes into one atomic, idempotent, workspace-safe
// security-definer RPC (rpc/create_project_from_quote) so a network hiccup
// or a bad row partway through can never leave a project half-built --
// either the whole structure exists correctly, or nothing does, and it's
// always safe to call again (it returns the existing project instead of
// duplicating it). Only photo copying stays client-side after that --
// copying a storage object is an HTTP call to the Storage API, not
// something the RPC's SQL transaction can wrap -- so each photo's
// copy+insert is tracked individually and reported back on the returned
// result instead of being silently swallowed (the original bug: see
// PRODUCT_ERROR_VISIBILITY_AUDIT.md's addendum). A retry skips photos the
// RPC reports as already copied (via source_quote_image_id) rather than
// re-copying and duplicating them; a copied-but-unsaved photo has its
// orphaned storage object cleaned up; a uniqueness conflict from a
// concurrent retry is confirmed and counted as already-copied, not a false
// failure.
export async function createProjectFromClosedWonQuote(quote: SalesQuote, accessToken?: string): Promise<ProjectConversionOutcome> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return { ok: false, reason: "unknown", message: GENERIC_PROJECT_CONVERSION_FAILURE_MESSAGE };
  }
  try {
    const rpcResponse = await fetch(supabaseUrl("rpc/create_project_from_quote"), {
      method: "POST",
      headers: supabaseHeaders(accessToken),
      body: JSON.stringify({ p_quote_id: quote.id }),
    });
    if (!rpcResponse.ok) {
      return await readProjectConversionRpcFailure(rpcResponse);
    }
    const rpcResult = (await rpcResponse.json()) as CreateProjectFromQuoteRpcResult;

    let totalPhotos = 0;
    let copiedPhotos = 0;
    let alreadyCopiedPhotos = 0;
    const failedPhotos: ProjectConversionPhotoFailure[] = [];

    for (const location of quote.locations) {
      const mapping = rpcResult.locations.find((entry) => entry.quote_location_id === location.id);
      if (!mapping) {
        // The RPC didn't report this location (e.g. it was soft-deleted
        // between the quote loading client-side and this call) -- there's
        // no project_location to attach photos to, so there's nothing to
        // copy or fail; move on to the next location.
        continue;
      }
      const alreadyCopiedIds = new Set(mapping.already_copied_quote_image_ids);
      for (const image of location.images) {
        totalPhotos += 1;
        if (alreadyCopiedIds.has(image.id)) {
          alreadyCopiedPhotos += 1;
          continue;
        }
        const locationName = location.name || "Unnamed location";
        const fileName = image.fileName || "Untitled photo";
        const destinationPath = buildProjectImageStoragePath(mapping.project_location_id, image.fileName || "file");
        const copied = await copyStorageObject(SALES_QUOTE_IMAGE_BUCKET, image.storagePath, PROJECT_LOCATION_IMAGE_BUCKET, destinationPath, accessToken);
        if (!copied) {
          failedPhotos.push({ locationName, fileName, reason: "Could not copy the file into the project's storage." });
          continue;
        }
        const imageInsertResponse = await fetch(supabaseUrl("project_location_images"), {
          method: "POST",
          headers: { ...supabaseHeaders(accessToken), prefer: "return=minimal" },
          body: JSON.stringify({
            project_location_id: mapping.project_location_id,
            image_type: image.imageType,
            storage_path: destinationPath,
            file_name: image.fileName || null,
            description: image.description || null,
            uploaded_at: image.uploadedAt,
            uploaded_by_email: image.uploadedByEmail || null,
            photo_lat: image.lat,
            photo_lng: image.lng,
            origin: "sales",
            source_quote_image_id: image.id,
          }),
        });
        if (imageInsertResponse.ok) {
          copiedPhotos += 1;
          continue;
        }
        if (imageInsertResponse.status === 409) {
          // Someone else's retry (another tab, a double-click) already
          // copied this exact photo and won the uniqueness race -- confirm
          // a row really exists before trusting that, then treat it as
          // already-copied rather than a false failure, and clean up this
          // attempt's now-redundant storage copy.
          const confirmResponse = await fetch(
            supabaseUrl(
              `project_location_images?project_location_id=eq.${mapping.project_location_id}&source_quote_image_id=eq.${image.id}&select=id&limit=1`,
            ),
            { headers: supabaseHeaders(accessToken) },
          );
          const confirmRows = confirmResponse.ok ? ((await confirmResponse.json().catch(() => [])) as Array<{ id: string }>) : [];
          await cleanupOrphanedProjectLocationImage(destinationPath, accessToken);
          if (confirmRows.length > 0) {
            alreadyCopiedPhotos += 1;
            continue;
          }
          console.error("createProjectFromClosedWonQuote: uniqueness conflict on project_location_images but no matching row found", mapping.project_location_id, image.id);
          failedPhotos.push({ locationName, fileName, reason: "The file copied but its record could not be confirmed." });
          continue;
        }
        const insertErrorBody = (await imageInsertResponse.json().catch(() => ({}))) as { message?: unknown };
        const insertErrorMessage = typeof insertErrorBody.message === "string" ? insertErrorBody.message : null;
        // The raw PostgREST message (which can include a constraint or
        // schema detail) is only ever logged, never shown to the user --
        // the failedPhotos reason is a stable, plain-language message
        // regardless of what the server actually said.
        console.error("createProjectFromClosedWonQuote: project_location_images insert failed", imageInsertResponse.status, insertErrorMessage);
        await cleanupOrphanedProjectLocationImage(destinationPath, accessToken);
        failedPhotos.push({
          locationName,
          fileName,
          reason: "The file copied, but its photo record could not be saved. Try Create Project again.",
        });
      }
    }

    const finalResponse = await fetch(supabaseUrl(`projects?id=eq.${rpcResult.project_id}&select=${PROJECT_SITE_SELECT}`), {
      headers: supabaseHeaders(accessToken),
    });
    if (!finalResponse.ok) {
      console.error(
        "createProjectFromClosedWonQuote: final project fetch failed",
        finalResponse.status,
        await finalResponse.text().catch(() => ""),
      );
      return { ok: false, reason: "unknown", message: GENERIC_PROJECT_CONVERSION_FAILURE_MESSAGE };
    }
    const finalRows = (await finalResponse.json()) as ProjectSiteRow[];
    if (!finalRows[0]) {
      return { ok: false, reason: "unknown", message: GENERIC_PROJECT_CONVERSION_FAILURE_MESSAGE };
    }
    return {
      ok: true,
      project: mapProjectSiteRow(finalRows[0]),
      alreadyExisted: rpcResult.already_existed,
      structureVerified: rpcResult.structure_verified,
      bomLineCount: rpcResult.bom_line_count,
      locationCount: rpcResult.location_count,
      locationItemCount: rpcResult.location_item_count,
      totalPhotos,
      copiedPhotos,
      alreadyCopiedPhotos,
      failedPhotos,
    };
  } catch (error) {
    console.error("createProjectFromClosedWonQuote threw", error);
    return { ok: false, reason: "unknown", message: GENERIC_PROJECT_CONVERSION_FAILURE_MESSAGE };
  }
}

// --- Migration 053: Quote Proposals ----------------------------------------
// A client-facing, e-signable proposal built from a Sales Quote's BOM + a
// shared, admin-editable boilerplate template. Deliberately built native
// in-app (not a PandaDoc integration) per E, cloning the exact same
// share-token / security-definer-RPC / click-to-approve pattern already
// proven by Project Submittals above -- just sourced from a sales_quote
// instead of a project. v1 ships as an HTML page with a browser
// Print/Save as PDF affordance; no PDF-generation library exists in this
// app, and that's the agreed amount of scope for now.

export type ProposalTemplateSection = {
  id: string;
  sectionKey: string;
  title: string;
  body: string;
  sequenceOrder: number;
  updatedAt: string;
};

type ProposalTemplateSectionRow = {
  id: string;
  section_key: string;
  title: string;
  body: string;
  sequence_order: number;
  updated_at: string;
};

function mapProposalTemplateSectionRow(row: ProposalTemplateSectionRow): ProposalTemplateSection {
  return {
    id: row.id,
    sectionKey: row.section_key,
    title: row.title,
    body: row.body,
    sequenceOrder: row.sequence_order,
    updatedAt: row.updated_at,
  };
}

export async function loadProposalTemplateSections(accessToken?: string): Promise<ProposalTemplateSection[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl("proposal_template_sections?select=*&order=sequence_order.asc"), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as ProposalTemplateSectionRow[];
  return rows.map(mapProposalTemplateSectionRow);
}

// Public (anon) read, used by the client-facing proposal page to render
// section titles/bodies -- these are gated select-open to authenticated
// only at the RLS layer, so the public page instead receives the sections
// baked into content_snapshot at send time (see createQuoteProposal),
// exactly like Submittals freeze their SOW text. This loader is for the
// authenticated Admin template editor screen only.
export async function updateProposalTemplateSection(
  id: string,
  updates: Partial<{ title: string; body: string; sequenceOrder: number }>,
  accessToken?: string,
): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const payload: Record<string, unknown> = {};
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.body !== undefined) payload.body = updates.body;
  if (updates.sequenceOrder !== undefined) payload.sequence_order = updates.sequenceOrder;
  payload.updated_at = new Date().toISOString();
  const response = await fetch(supabaseUrl(`proposal_template_sections?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  return response.ok;
}

export type ProposalBomLineSnapshot = {
  item: string;
  qty: number;
  notes: string;
  // Pulled from the linked catalog item (if any) at send time and frozen
  // into the snapshot, same reasoning as Submittals freezing the BOM --
  // if the catalog item changes later, already-sent proposals shouldn't
  // silently change under the client.
  imageUrl: string;
  description: string;
  manufacturer: string;
  hasDatasheet: boolean;
  datasheetUrl: string;
};

export type ProposalTemplateSectionSnapshot = { title: string; body: string };

export type ProposalSnapshot = {
  clientName: string;
  siteName: string;
  city: string;
  quoteRef: string;
  proposalSummary: string;
  bom: ProposalBomLineSnapshot[];
  templateSections: ProposalTemplateSectionSnapshot[];
};

export type SalesQuoteProposal = {
  id: string;
  quoteId: string;
  version: number;
  status: "draft" | "sent" | "approved" | "rejected" | "revision_requested";
  contentSnapshot: ProposalSnapshot;
  clientName: string;
  clientEmail: string;
  sentAt: string | null;
  respondedAt: string | null;
  responseNotes: string;
  approvalName: string;
  shareToken: string | null;
  createdAt: string;
};

export type PublicQuoteProposalView = {
  proposalId: string;
  status: SalesQuoteProposal["status"];
  version: number;
  contentSnapshot: ProposalSnapshot;
  clientName: string;
  // Added by migration 119 -- lets the public page show "This proposal
  // was approved on <date>" with real data instead of a bare status.
  respondedAt: string | null;
  approvalName: string | null;
};

// Migration 119: distinguishes "the RPC ran and here's what it found" from
// "something actually broke," per the fix requirements -- see
// PRODUCT_TOKEN_BACKUP_CONTENT_TEST_AUDIT.md's "A3 resolution" section.
export type PublicQuoteProposalResult =
  | { outcome: "found"; data: PublicQuoteProposalView }
  | { outcome: "invalid_token" }
  | { outcome: "error" };

export type ProposalResponseOutcome = "success" | "already_responded" | "invalid_token" | "error";

// Always carries the AUTHORITATIVE current state of the proposal, even
// when outcome is "already_responded" (someone else's response, or a
// stale resubmission) -- the caller should render this state directly
// rather than treating a non-"success" outcome as a bare failure.
export type ProposalResponseResult = {
  outcome: ProposalResponseOutcome;
  status: SalesQuoteProposal["status"] | null;
  respondedAt: string | null;
  approvalName: string | null;
  version: number | null;
};

type SalesQuoteProposalRow = {
  id: string;
  quote_id: string;
  version: number;
  status: string;
  content_snapshot: ProposalSnapshot;
  client_name: string | null;
  client_email: string | null;
  sent_at: string | null;
  responded_at: string | null;
  response_notes: string | null;
  approval_name: string | null;
  created_at: string;
};

function mapQuoteProposalRow(row: SalesQuoteProposalRow, shareToken: string | null): SalesQuoteProposal {
  return {
    id: row.id,
    quoteId: row.quote_id,
    version: row.version,
    status: row.status as SalesQuoteProposal["status"],
    contentSnapshot: row.content_snapshot,
    clientName: row.client_name ?? "",
    clientEmail: row.client_email ?? "",
    sentAt: row.sent_at,
    respondedAt: row.responded_at,
    responseNotes: row.response_notes ?? "",
    approvalName: row.approval_name ?? "",
    shareToken,
    createdAt: row.created_at,
  };
}

export async function loadProposalsForQuote(quoteId: string, accessToken?: string): Promise<SalesQuoteProposal[]> {
  if (!isRemotePersistenceConfigured() || !accessToken || !quoteId) {
    return [];
  }
  const [proposalsRes, tokensRes] = await Promise.all([
    fetch(supabaseUrl(`sales_quote_proposals?quote_id=eq.${quoteId}&select=*&order=version.desc`), {
      headers: supabaseHeaders(accessToken),
    }),
    fetch(supabaseUrl(`public_share_tokens?entity_type=eq.sales_quote_proposal&select=token,entity_id`), {
      headers: supabaseHeaders(accessToken),
    }),
  ]);
  if (!proposalsRes.ok) {
    return [];
  }
  const rows = (await proposalsRes.json()) as SalesQuoteProposalRow[];
  const tokenRows = tokensRes.ok ? ((await tokensRes.json()) as ShareTokenRow[]) : [];
  return rows.map((row) => mapQuoteProposalRow(row, tokenRows.find((entry) => entry.entity_id === row.id)?.token ?? null));
}

export async function createQuoteProposal(
  input: { quoteId: string; version: number; contentSnapshot: ProposalSnapshot; clientName: string; clientEmail: string },
  accessToken?: string,
): Promise<SalesQuoteProposal> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }
  const response = await fetch(supabaseUrl("sales_quote_proposals"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({
      quote_id: input.quoteId,
      version: input.version,
      status: "sent",
      content_snapshot: input.contentSnapshot,
      client_name: input.clientName || null,
      client_email: input.clientEmail || null,
      sent_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not create proposal: ${response.status}`);
  }
  const rows = (await response.json()) as SalesQuoteProposalRow[];
  return mapQuoteProposalRow(rows[0], null);
}

export async function createQuoteProposalShareToken(proposalId: string, accessToken?: string): Promise<string> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    throw new Error("Supabase is not configured.");
  }
  const token = generateShareToken();
  const response = await fetch(supabaseUrl("public_share_tokens"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ token, entity_type: "sales_quote_proposal", entity_id: proposalId }),
  });
  if (!response.ok) {
    throw new Error(`Could not create share link: ${response.status}`);
  }
  return token;
}

export async function fetchPublicQuoteProposal(token: string): Promise<PublicQuoteProposalResult> {
  if (!isRemotePersistenceConfigured() || !token) {
    return { outcome: "error" };
  }
  let response: Response;
  try {
    response = await fetch(supabaseUrl("rpc/get_quote_proposal_by_token"), {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({ share_token: token }),
    });
  } catch {
    return { outcome: "error" };
  }
  if (!response.ok) {
    return { outcome: "error" };
  }
  const rows = (await response.json()) as Array<{
    proposal_id: string;
    status: string;
    version: number;
    content_snapshot: ProposalSnapshot;
    client_name: string | null;
    responded_at: string | null;
    approval_name: string | null;
  }>;
  if (!rows.length) {
    // A well-formed request that resolved zero rows means the token
    // itself doesn't match a live, unexpired proposal -- distinct from a
    // network/server failure (see migration 119, get_quote_proposal_by_token).
    return { outcome: "invalid_token" };
  }
  const row = rows[0];
  return {
    outcome: "found",
    data: {
      proposalId: row.proposal_id,
      status: row.status as SalesQuoteProposal["status"],
      version: row.version,
      contentSnapshot: row.content_snapshot,
      clientName: row.client_name ?? "",
      respondedAt: row.responded_at,
      approvalName: row.approval_name,
    },
  };
}

export async function respondToPublicQuoteProposal(
  token: string,
  newStatus: "approved" | "rejected" | "revision_requested",
  approverName: string,
  notes: string,
): Promise<ProposalResponseResult> {
  const failed: ProposalResponseResult = { outcome: "error", status: null, respondedAt: null, approvalName: null, version: null };
  if (!isRemotePersistenceConfigured() || !token) {
    return failed;
  }
  let response: Response;
  try {
    response = await fetch(supabaseUrl("rpc/respond_to_quote_proposal"), {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({
        share_token: token,
        new_status: newStatus,
        approver_name: approverName || "Unknown",
        approver_ip: "",
        notes: notes || "",
      }),
    });
  } catch {
    return failed;
  }
  if (!response.ok) {
    return failed;
  }
  const rows = (await response.json()) as Array<{
    outcome: string;
    status: string | null;
    responded_at: string | null;
    approval_name: string | null;
    version: number | null;
  }>;
  if (!rows.length) {
    return failed;
  }
  const row = rows[0];
  return {
    outcome: (["success", "already_responded", "invalid_token"] as string[]).includes(row.outcome)
      ? (row.outcome as ProposalResponseOutcome)
      : "error",
    status: (row.status as SalesQuoteProposal["status"] | null) ?? null,
    respondedAt: row.responded_at,
    approvalName: row.approval_name,
    version: row.version,
  };
}

// --- Migration 058: Site Intake Questionnaire ------------------------------
// Reuses the Phase 18 Fluid Form Engine's generic form_schemas/
// form_schema_fields (loadFormSchema/addFormSchemaField/etc. above already
// work for any form_key, including the new 'sales_site_intake' one) --
// only the response storage is new, since project_handovers is
// project-specific. One row per quote (unique quote_id): this is the
// sales team's ongoing working notes on a client, not a one-time signed
// capture, so it's a plain upsert rather than draft/submitted like
// Handovers.

export type SalesQuoteIntakeResponse = {
  id: string;
  quoteId: string;
  formSchemaId: string;
  responses: Record<string, string>;
  updatedAt: string;
};

type SalesQuoteIntakeResponseRow = {
  id: string;
  quote_id: string;
  form_schema_id: string;
  responses: Record<string, string>;
  updated_at: string;
};

function mapSalesQuoteIntakeResponseRow(row: SalesQuoteIntakeResponseRow): SalesQuoteIntakeResponse {
  return {
    id: row.id,
    quoteId: row.quote_id,
    formSchemaId: row.form_schema_id,
    responses: row.responses ?? {},
    updatedAt: row.updated_at,
  };
}

export async function loadSalesQuoteIntakeResponse(quoteId: string, accessToken?: string): Promise<SalesQuoteIntakeResponse | null> {
  if (!isRemotePersistenceConfigured() || !accessToken || !quoteId) {
    return null;
  }
  const response = await fetch(supabaseUrl(`sales_quote_intake_responses?quote_id=eq.${quoteId}&select=*&limit=1`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as SalesQuoteIntakeResponseRow[];
  return rows[0] ? mapSalesQuoteIntakeResponseRow(rows[0]) : null;
}

export async function upsertSalesQuoteIntakeResponse(
  quoteId: string,
  formSchemaId: string,
  responses: Record<string, string>,
  accessToken?: string,
): Promise<SalesQuoteIntakeResponse | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const response = await fetch(supabaseUrl("sales_quote_intake_responses?on_conflict=quote_id"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ quote_id: quoteId, form_schema_id: formSchemaId, responses }),
  });
  if (!response.ok) {
    throw new Error(`Could not save the site intake questionnaire: ${response.status}`);
  }
  const rows = (await response.json()) as SalesQuoteIntakeResponseRow[];
  return rows[0] ? mapSalesQuoteIntakeResponseRow(rows[0]) : null;
}

// Lets a rep go back and view/edit a quote's original "New Site" intake
// fields -- previously client_name/site_name/city were only ever set once
// at creation, with no screen to revisit them afterward.
export async function updateSalesQuoteInfo(
  quoteId: string,
  updates: Partial<{
    clientName: string;
    siteName: string;
    city: string;
    clientEmail: string;
    contactFullName: string;
    contactPhone: string;
    preferredCommunication: string;
    siteStreetAddress: string;
    siteState: string;
    siteZip: string;
    clientStreetAddress: string;
    clientCity: string;
    clientState: string;
    clientZip: string;
    saasType: string;
    saasContractAmount: number | null;
    saasBillingFrequency: SalesQuote["saasBillingFrequency"];
    saleAmount: number | null;
  }>,
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (updates.clientName !== undefined) payload.client_name = updates.clientName;
  if (updates.siteName !== undefined) payload.site_name = updates.siteName;
  if (updates.city !== undefined) payload.city = updates.city;
  if (updates.clientEmail !== undefined) payload.client_email = updates.clientEmail;
  if (updates.contactFullName !== undefined) payload.contact_full_name = updates.contactFullName;
  if (updates.contactPhone !== undefined) payload.contact_phone = updates.contactPhone;
  if (updates.preferredCommunication !== undefined) payload.preferred_communication = updates.preferredCommunication;
  if (updates.siteStreetAddress !== undefined) payload.site_street_address = updates.siteStreetAddress;
  if (updates.siteState !== undefined) payload.site_state = updates.siteState;
  if (updates.siteZip !== undefined) payload.site_zip = updates.siteZip;
  if (updates.clientStreetAddress !== undefined) payload.client_street_address = updates.clientStreetAddress;
  if (updates.clientCity !== undefined) payload.client_city = updates.clientCity;
  if (updates.clientState !== undefined) payload.client_state = updates.clientState;
  if (updates.clientZip !== undefined) payload.client_zip = updates.clientZip;
  if (updates.saasType !== undefined) payload.saas_type = updates.saasType || null;
  if (updates.saasContractAmount !== undefined) payload.saas_contract_amount = updates.saasContractAmount;
  if (updates.saasBillingFrequency !== undefined) payload.saas_billing_frequency = updates.saasBillingFrequency || null;
  if (updates.saleAmount !== undefined) payload.sale_amount = updates.saleAmount;
  if (Object.keys(payload).length === 0) {
    return;
  }
  // Overnight audit (2026-09-11, task 2): this PATCH was completely
  // unchecked. Safe to verify here -- the caller (handleUpdateSalesQuoteInfo)
  // already has a real try/catch that shows a visible status message, so a
  // throw here reaches the user instead of vanishing or becoming an
  // unhandled rejection.
  const response = await fetch(supabaseUrl(`sales_quotes?id=eq.${quoteId}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`updateSalesQuoteInfo failed for quote ${quoteId} (${response.status}): ${bodyText}`);
    throw new Error("Could not save this change.");
  }
  const rows = (await response.json().catch(() => [])) as unknown[];
  if (rows.length === 0) {
    console.error(`updateSalesQuoteInfo affected 0 rows for quote ${quoteId} -- likely blocked by RLS or a missing quote.`);
    throw new Error("Could not save this change.");
  }
}
