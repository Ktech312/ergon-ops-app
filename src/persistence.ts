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
};

const LOCAL_STATE_KEY = "ergon:app-state:v1";
const AUTH_SESSION_KEY = "ergon:auth-session:v1";
const WORKSPACE_KEY = "default";
const STATE_KEYS: Array<keyof PersistedAppState> = ["roleMode"];

function envValue(key: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY") {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.[key] ?? "";
}

export function isRemotePersistenceConfigured() {
  return Boolean(envValue("VITE_SUPABASE_URL") && envValue("VITE_SUPABASE_ANON_KEY"));
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
    throw new Error(`Sign in failed: ${response.status}`);
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
    throw new Error(`Sign up failed: ${response.status}`);
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
    throw new Error(`Session refresh failed: ${response.status}`);
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

  const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (!rawHash || !rawHash.includes("access_token")) {
    return null;
  }

  const params = new URLSearchParams(rawHash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const expiresIn = params.get("expires_in");
  const errorDescription = params.get("error_description");

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
  };

  saveAuthSession(session);
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

  const response = await fetch(supabaseUrl("app_transaction_locks"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "return=representation",
    },
    body: JSON.stringify({
      workspace_key: WORKSPACE_KEY,
      lock_type: lockType,
      lock_key: lockKey,
      owner_label: "ergon-web-app",
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Record is locked for another operation: ${lockKey}`);
  }

  const rows = (await response.json()) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
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
export async function setUserAllowedViews(userId: string, allowedViews: string[] | null, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const response = await fetch(supabaseUrl(`app_user_roles?user_id=eq.${userId}&is_primary=eq.true`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({
      allowed_views: allowedViews,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Could not update tab permissions: ${response.status}`);
  }
}

// Sets a user's PRIMARY role (the one that drives their default tab set).
// Deletes any existing primary row first, since a user should only ever
// have exactly one -- then upserts the new one (on the real user_id+role_key
// unique index from migration 040), which also correctly "promotes" a role
// that was already held as secondary rather than erroring on a duplicate.
export async function setPrimaryUserRole(userId: string, roleKey: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  await fetch(supabaseUrl(`app_user_roles?user_id=eq.${userId}&is_primary=eq.true&role_key=neq.${roleKey}`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });

  const response = await fetch(supabaseUrl("app_user_roles?on_conflict=user_id,role_key"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      user_id: userId,
      role_key: roleKey,
      is_primary: true,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Could not set primary role: ${response.status}`);
  }
}

// Secondary roles: additional access without replacing the primary role.
// Replaces the user's whole secondary set with the given list -- simpler
// and just as correct as diffing, since this is an infrequent admin action
// on a short list, not a hot path.
export async function setSecondaryUserRoles(userId: string, roleKeys: string[], accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  await fetch(supabaseUrl(`app_user_roles?user_id=eq.${userId}&is_primary=eq.false`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });

  if (roleKeys.length === 0) {
    return;
  }

  const response = await fetch(supabaseUrl("app_user_roles?on_conflict=user_id,role_key"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(roleKeys.map((roleKey) => ({
      user_id: userId,
      role_key: roleKey,
      is_primary: false,
      updated_at: new Date().toISOString(),
    }))),
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

  await fetch(supabaseUrl(`user_invites?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ status: "revoked" }),
  });
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

  return response.ok;
}

export type KnownUser = {
  userId: string;
  email: string;
  lastSeenAt: string;
};

export async function upsertKnownUser(userId: string, email: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  await fetch(supabaseUrl("app_known_users?on_conflict=user_id"), {
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
  }).catch(() => undefined);
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

export async function setUserRole(userId: string, roleKey: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const response = await fetch(supabaseUrl("app_user_roles?on_conflict=user_id"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      user_id: userId,
      role_key: roleKey,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Could not update role: ${response.status}`);
  }
}

export async function grantAdmin(userId: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const response = await fetch(supabaseUrl("app_admins?on_conflict=user_id"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ user_id: userId }),
  });

  if (!response.ok) {
    throw new Error(`Could not grant admin: ${response.status}`);
  }
}

export async function revokeAdmin(userId: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  const response = await fetch(supabaseUrl(`app_admins?user_id=eq.${userId}`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
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

  await fetch(supabaseUrl(`product_catalog?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({
      is_retired: retired,
      retired_at: retired ? new Date().toISOString() : null,
    }),
  });
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
  await fetch(supabaseUrl(`product_catalog?id=eq.${request.catalogItemId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ [columnByField[request.fieldChanged]]: request.requestedValue }),
  });
  await fetch(supabaseUrl(`catalog_price_change_requests?id=eq.${request.id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ status: "approved", reviewed_by_email: reviewerEmail, reviewed_at: new Date().toISOString() }),
  });
}

export async function rejectCatalogPriceChangeRequest(id: string, reviewerEmail: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`catalog_price_change_requests?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ status: "rejected", reviewed_by_email: reviewerEmail, reviewed_at: new Date().toISOString() }),
  });
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
    headers: supabaseHeaders(accessToken),
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

  const response = await fetch(supabaseUrl("tasks?select=*&deleted_at=is.null&order=created_at.desc"), {
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

  try {
    await fetch(supabaseUrl("task_activity_log"), {
      method: "POST",
      headers: supabaseHeaders(accessToken),
      body: JSON.stringify({ task_id: taskId, actor_email: actorEmail || null, message }),
    });
  } catch {
    // Best-effort -- a logging failure should never block the actual save.
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
};

type TeamMemberRow = {
  id: string;
  full_name: string;
  email: string | null;
  role_title: string | null;
  is_active: boolean;
  primary_role: string | null;
  secondary_roles: string[] | null;
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
    }
    await fetch(supabaseUrl("team_members"), {
      method: "POST",
      headers: supabaseHeaders(accessToken),
      body: JSON.stringify({ full_name: fullNameGuess, email, role_title: null, is_active: true }),
    });
  } catch {
    // Best-effort convenience only -- if this fails (e.g. a race with
    // another tab, or RLS denies a non-admin/manager), the person can
    // still be added manually from Team Roster.
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

// Returns the created row's id, or null if nothing was actually inserted
// (Supabase's resolution=ignore-duplicates silently skips a row whose
// dedupe_key already exists rather than erroring -- that's used below by
// notify() to avoid re-sending the same email twice for the same event).
export async function createNotification(
  notification: { recipientEmail: string; eventType: string; title: string; body: string; relatedEntityType?: string; relatedEntityId?: string; dedupeKey?: string },
  accessToken?: string,
): Promise<{ id: string } | null> {
  if (!isRemotePersistenceConfigured() || !accessToken || !notification.recipientEmail) {
    return null;
  }

  const response = await fetch(supabaseUrl("notifications"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify({
      recipient_email: notification.recipientEmail,
      event_type: notification.eventType,
      title: notification.title,
      body: notification.body,
      related_entity_type: notification.relatedEntityType ?? null,
      related_entity_id: notification.relatedEntityId ?? null,
      dedupe_key: notification.dedupeKey ?? null,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const rows = (await response.json()) as Array<{ id: string }>;
  return rows[0] ? { id: rows[0].id } : null;
}

// Audit trail for non-in-app delivery attempts (migration 024's
// notification_deliveries table) -- one row per channel per notification,
// so "did the email actually go out" is a real, reviewable fact instead of
// a guess.
export async function recordNotificationDelivery(
  notificationId: string,
  channel: "email" | "slack" | "teams",
  status: "sent" | "failed" | "skipped",
  errorMessage?: string,
  accessToken?: string,
) {
  if (!isRemotePersistenceConfigured() || !accessToken || !notificationId) {
    return;
  }

  await fetch(supabaseUrl("notification_deliveries"), {
    method: "POST",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ notification_id: notificationId, channel, status, error_message: errorMessage || null }),
  }).catch(() => undefined);
}

export async function markNotificationRead(id: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  await fetch(supabaseUrl(`notifications?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ is_read: true }),
  });
}

export async function markAllNotificationsRead(email: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken || !email) {
    return;
  }

  await fetch(supabaseUrl(`notifications?recipient_email=eq.${encodeURIComponent(email)}&is_read=eq.false`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ is_read: true }),
  });
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
    fetch(supabaseUrl("project_schedule_template_phases?select=*&order=sequence_order.asc"), { headers: supabaseHeaders(accessToken) }),
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

export async function deleteScheduleTemplatePhase(id: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`project_schedule_template_phases?id=eq.${id}`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });
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

export async function fetchPublicSubmittal(token: string): Promise<PublicSubmittalView | null> {
  if (!isRemotePersistenceConfigured() || !token) {
    return null;
  }

  const response = await fetch(supabaseUrl("rpc/get_submittal_by_token"), {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify({ share_token: token }),
  });

  if (!response.ok) {
    return null;
  }

  const rows = (await response.json()) as Array<{
    submittal_id: string;
    status: string;
    version: number;
    content_snapshot: SubmittalSnapshot;
    client_name: string | null;
    project_name: string;
  }>;

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  return {
    submittalId: row.submittal_id,
    status: row.status as ProjectSubmittal["status"],
    version: row.version,
    contentSnapshot: row.content_snapshot,
    clientName: row.client_name ?? "",
    projectName: row.project_name,
  };
}

export async function respondToPublicSubmittal(
  token: string,
  newStatus: "approved" | "rejected" | "revision_requested",
  approverName: string,
  notes: string,
): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !token) {
    return false;
  }

  const response = await fetch(supabaseUrl("rpc/respond_to_submittal"), {
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

  return response.ok;
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

  const fieldsRes = await fetch(
    supabaseUrl(`form_schema_fields?form_schema_id=eq.${schema.id}&select=*&order=sequence_order.asc`),
    { headers: supabaseHeaders(accessToken) },
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

  await fetch(supabaseUrl(`form_schema_fields?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
}

export async function deleteFormSchemaField(id: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`form_schema_fields?id=eq.${id}`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });
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
  const response = await fetch(supabaseUrl("presales_hardware_rules?select=*&order=tier.asc,sequence_order.asc"), {
    headers: supabaseHeaders(accessToken),
  });
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

export async function deletePresalesRule(id: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`presales_hardware_rules?id=eq.${id}`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });
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
  const response = await fetch(supabaseUrl("site_hardware_rules?select=*&order=metric.asc,sequence_order.asc"), {
    headers: supabaseHeaders(accessToken),
  });
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

  await fetch(supabaseUrl(`site_hardware_rules?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
}

export async function deleteSiteHardwareRule(id: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`site_hardware_rules?id=eq.${id}`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });
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
  const response = await fetch(supabaseUrl("task_hardware_dependencies?select=*"), {
    headers: supabaseHeaders(accessToken),
  });
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
    throw new Error(`Could not link hardware to task: ${response.status}`);
  }
  const rows = (await response.json()) as TaskHardwareDependencyRow[];
  return mapTaskDependencyRow(rows[0]);
}

export async function updateTaskHardwareDependencyStatus(
  id: string,
  fulfillmentStatus: TaskHardwareDependency["fulfillmentStatus"],
  accessToken?: string,
): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`task_hardware_dependencies?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ fulfillment_status: fulfillmentStatus }),
  });
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

export async function deleteTaskHardwareDependency(id: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`task_hardware_dependencies?id=eq.${id}`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });
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
  type?: "Procurement" | "Sales Quote" | "SOW" | "BOM" | "Project";
  storage?: "Browser" | "Google Drive" | "Supabase Storage";
  uploadedAt?: string;
  // Path inside the private "project-documents" Storage bucket -- present
  // once the real file bytes were actually uploaded (Phase: real file
  // storage). Resolve it to a usable link with getDocumentDownloadUrl.
  storagePath?: string;
};

type ProjectDocumentRow = {
  id: string;
  project_name: string | null;
  file_name: string;
  file_size_bytes: number | string;
  status: string;
  document_type: string;
  storage_status: string;
  uploaded_at: string | null;
  file_url: string | null;
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
    name: row.file_name,
    project: row.project_name ?? "",
    size: Number(row.file_size_bytes),
    status: appDocumentStatus(row.status),
    type: pgDocumentType(row.document_type),
    storage: appDocumentStorage(row.storage_status),
    uploadedAt: row.uploaded_at ?? undefined,
    storagePath: row.file_url ?? undefined,
  };
}

export async function loadProjectDocuments(accessToken?: string): Promise<ProjectDocument[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl("project_documents?select=id,project_name,file_name,file_size_bytes,status,document_type,storage_status,uploaded_at,file_url&order=uploaded_at.desc"), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
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
  }));
  const response = await fetch(supabaseUrl("project_documents"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
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
  await fetch(supabaseUrl(`project_documents?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ status: pgDocumentStatus(status) }),
  });
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
  };
}

const PURCHASE_REQUEST_SELECT =
  "id,request_number,sku_snapshot,item_name_snapshot,quantity_requested,reason,source_ref,project_name,procurement_track,preferred_vendor,po_number,expected_date,estimated_unit_cost,quantity_received,status,created_at,notes,requested_by_email";

export async function loadPurchaseRequests(accessToken?: string): Promise<PurchaseRequest[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl(`purchase_requests?select=${PURCHASE_REQUEST_SELECT}&order=created_at.desc`), {
    headers: supabaseHeaders(accessToken),
  });
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
  if (Object.keys(payload).length === 0) {
    return;
  }
  await fetch(supabaseUrl(`purchase_requests?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
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
  reorderPoint: number;
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
  inventory_balances: Array<{ quantity_on_hand: number | string }> | null;
};

const INVENTORY_ITEM_SELECT =
  "id,sku,item_name,description,manufacturer,category,default_unit_cost,reorder_point,vendor_url,image_url,barcode_value,purchase_sources,price_history,inventory_tags,is_active,inventory_balances(quantity_on_hand)";

function mapInventoryItemRow(row: InventoryItemRow): Part {
  const stock = (row.inventory_balances ?? []).reduce((sum, balance) => sum + (Number(balance.quantity_on_hand) || 0), 0);
  return {
    ref: row.sku,
    name: row.item_name,
    description: row.description ?? "",
    manufacturer: row.manufacturer ?? "",
    category: (row.category as Part["category"]) ?? "Base",
    cost: Number(row.default_unit_cost) || 0,
    stock,
    reorderPoint: Number(row.reorder_point) || 0,
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
    vendor_url: item.vendorUrl || null,
    image_url: item.imageUrl || null,
    barcode_value: item.barcode || null,
    purchase_sources: item.purchaseUrls ?? [],
    price_history: item.priceHistory ?? [],
    inventory_tags: item.tags ?? [],
    is_active: !item.retired,
  }));

  const itemResponse = await fetch(supabaseUrl("inventory_items?on_conflict=sku"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(itemPayload),
  });
  if (!itemResponse.ok) {
    throw new Error(`Could not save inventory items: ${itemResponse.status}`);
  }
  const savedRows = (await itemResponse.json()) as Array<{ id: string; sku: string }>;
  const idBySku = new Map(savedRows.map((row) => [row.sku, row.id]));

  const locationId = await getMainWarehouseLocationId(accessToken);
  if (!locationId) {
    return;
  }
  const balancePayload = items
    .map((item) => {
      const inventoryItemId = idBySku.get(item.ref);
      return inventoryItemId ? { inventory_item_id: inventoryItemId, location_id: locationId, quantity_on_hand: item.stock } : null;
    })
    .filter((row): row is { inventory_item_id: string; location_id: string; quantity_on_hand: number } => row !== null);

  if (balancePayload.length === 0) {
    return;
  }
  await fetch(supabaseUrl("inventory_balances?on_conflict=inventory_item_id,location_id"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(balancePayload),
  });
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

export type BuildRecipe = {
  name: string;
  outputName: string;
  description: string;
  imageUrl?: string;
  components: BuildComponent[];
  retired?: boolean;
};

type EquipmentTypeRow = {
  equipment_name: string;
  description: string | null;
  image_url: string | null;
  is_retired: boolean;
  output_item: { item_name: string } | null;
  equipment_bom_components: Array<{ quantity_required: number | string; item: { item_name: string } | null }>;
};

const EQUIPMENT_TYPE_SELECT =
  "equipment_name,description,image_url,is_retired,output_item:inventory_items!output_inventory_item_id(item_name),equipment_bom_components(quantity_required,item:inventory_items(item_name))";

function mapEquipmentTypeRow(row: EquipmentTypeRow): BuildRecipe {
  return {
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

export async function saveDeviceRecipes(recipes: BuildRecipe[], accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken || recipes.length === 0) {
    return;
  }

  // One query resolves every item name (recipe outputs + component lines)
  // referenced anywhere in the current recipe set to its inventory_items.id.
  const itemNames = new Set<string>();
  recipes.forEach((recipe) => {
    itemNames.add(recipe.outputName);
    recipe.components.forEach((component) => itemNames.add(component.itemName));
  });
  const namesParam = Array.from(itemNames)
    .map((name) => `"${name.replace(/"/g, '\\"')}"`)
    .join(",");
  const itemsResponse = await fetch(supabaseUrl(`inventory_items?select=id,item_name&item_name=in.(${namesParam})`), {
    headers: supabaseHeaders(accessToken),
  });
  const itemRows = itemsResponse.ok ? ((await itemsResponse.json()) as Array<{ id: string; item_name: string }>) : [];
  const itemIdByName = new Map(itemRows.map((row) => [row.item_name, row.id]));

  // Which recipes already exist (by equipment_name, the natural key)?
  const existingResponse = await fetch(supabaseUrl("equipment_types?select=id,equipment_name"), {
    headers: supabaseHeaders(accessToken),
  });
  const existingRows = existingResponse.ok ? ((await existingResponse.json()) as Array<{ id: string; equipment_name: string }>) : [];
  const equipmentIdByName = new Map(existingRows.map((row) => [row.equipment_name, row.id]));

  for (const recipe of recipes) {
    const outputInventoryItemId = itemIdByName.get(recipe.outputName) ?? null;
    const fields = {
      description: recipe.description || null,
      image_url: recipe.imageUrl || null,
      output_inventory_item_id: outputInventoryItemId,
      is_retired: Boolean(recipe.retired),
      retired_at: recipe.retired ? new Date().toISOString() : null,
    };

    let equipmentTypeId = equipmentIdByName.get(recipe.name);
    if (equipmentTypeId) {
      await fetch(supabaseUrl(`equipment_types?id=eq.${equipmentTypeId}`), {
        method: "PATCH",
        headers: supabaseHeaders(accessToken),
        body: JSON.stringify(fields),
      });
    } else {
      const insertResponse = await fetch(supabaseUrl("equipment_types"), {
        method: "POST",
        headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
        body: JSON.stringify({
          equipment_number: `EQ-${Date.now().toString(36).toUpperCase()}-${Math.round(Math.random() * 999)}`,
          equipment_name: recipe.name,
          ...fields,
        }),
      });
      if (!insertResponse.ok) {
        continue;
      }
      const created = (await insertResponse.json()) as Array<{ id: string }>;
      equipmentTypeId = created[0]?.id;
      if (!equipmentTypeId) {
        continue;
      }
    }

    // Reconcile BOM component lines: upsert current ones, delete removed ones.
    const desiredComponentIds = recipe.components
      .map((component) => itemIdByName.get(component.itemName))
      .filter((id): id is string => Boolean(id));

    const componentPayload = recipe.components
      .map((component, index) => {
        const inventoryItemId = itemIdByName.get(component.itemName);
        return inventoryItemId
          ? { equipment_type_id: equipmentTypeId, inventory_item_id: inventoryItemId, quantity_required: Math.max(0.01, component.qty), line_sort: index, is_active: true }
          : null;
      })
      .filter((row): row is { equipment_type_id: string; inventory_item_id: string; quantity_required: number; line_sort: number; is_active: boolean } => row !== null);

    if (componentPayload.length > 0) {
      await fetch(supabaseUrl("equipment_bom_components?on_conflict=equipment_type_id,inventory_item_id"), {
        method: "POST",
        headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(componentPayload),
      });
    }

    const existingComponentsResponse = await fetch(
      supabaseUrl(`equipment_bom_components?equipment_type_id=eq.${equipmentTypeId}&select=inventory_item_id`),
      { headers: supabaseHeaders(accessToken) },
    );
    const existingComponentRows = existingComponentsResponse.ok ? ((await existingComponentsResponse.json()) as Array<{ inventory_item_id: string }>) : [];
    const toRemove = existingComponentRows.map((row) => row.inventory_item_id).filter((id) => !desiredComponentIds.includes(id));
    if (toRemove.length > 0) {
      await fetch(
        supabaseUrl(`equipment_bom_components?equipment_type_id=eq.${equipmentTypeId}&inventory_item_id=in.(${toRemove.join(",")})`),
        { method: "DELETE", headers: supabaseHeaders(accessToken) },
      );
    }
  }
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
  inventory_item: { sku: string; item_name: string } | null;
  project: { project_name: string } | null;
  build_transaction: { build_number: string } | null;
};

const INVENTORY_MOVEMENT_SELECT =
  "legacy_id,movement_type,quantity,balance_before,balance_after,reference_number,notes,created_at,inventory_item:inventory_items(sku,item_name),project:projects(project_name),build_transaction:build_transactions(build_number)";

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
  };
}

export async function loadInventoryMovements(accessToken?: string): Promise<InventoryMovement[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(
    supabaseUrl(`inventory_movements?select=${INVENTORY_MOVEMENT_SELECT}&legacy_id=not.is.null&order=created_at.desc&limit=2000`),
    { headers: supabaseHeaders(accessToken) },
  );
  if (!response.ok) {
    return [];
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
    fetch(supabaseUrl(`build_transactions?select=${BUILD_TRANSACTION_SELECT}&order=created_at.desc&limit=2000`), { headers: supabaseHeaders(accessToken) }),
    loadInventoryMovements(accessToken),
  ]);
  if (!buildsResponse.ok) {
    return [];
  }
  const rows = (await buildsResponse.json()) as BuildTransactionRow[];
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
  const equipmentResponse = await fetch(supabaseUrl("equipment_types?select=equipment_name,output_inventory_item_id"), {
    headers: supabaseHeaders(accessToken),
  });
  const equipmentRows = equipmentResponse.ok ? ((await equipmentResponse.json()) as Array<{ equipment_name: string; output_inventory_item_id: string | null }>) : [];
  const equipmentByName = new Map(equipmentRows.map((row) => [row.equipment_name, row]));

  const payload = builds.map((build) => ({
    build_number: build.buildNumber,
    equipment_type_id: null,
    finished_inventory_item_id: equipmentByName.get(build.equipmentName)?.output_inventory_item_id ?? null,
    quantity_built: build.quantityBuilt,
    status: build.status,
    workflow_stage: build.stage ?? "complete",
    created_at: build.createdAt,
    undone_at: build.undoneAt ?? null,
  }));
  await fetch(supabaseUrl("build_transactions?on_conflict=build_number"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(payload),
  });
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

export async function saveInventoryMovements(movements: InventoryMovement[], accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken || movements.length === 0) {
    return;
  }
  const skus = Array.from(new Set(movements.map((m) => m.sku).filter(Boolean)));
  const projectNames = Array.from(new Set(movements.map((m) => m.projectName).filter((name): name is string => Boolean(name))));
  const buildNumbers = Array.from(new Set(movements.map((m) => m.buildNumber).filter((n): n is string => Boolean(n))));

  const [itemRows, projectRows, buildRows] = await Promise.all([
    skus.length
      ? fetch(supabaseUrl(`inventory_items?select=id,sku&sku=in.(${skus.map((s) => `"${s}"`).join(",")})`), { headers: supabaseHeaders(accessToken) }).then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; sku: string }>>) : []))
      : Promise.resolve([]),
    projectNames.length
      ? fetch(supabaseUrl(`projects?select=id,project_name&project_name=in.(${projectNames.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(",")})`), { headers: supabaseHeaders(accessToken) }).then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; project_name: string }>>) : []))
      : Promise.resolve([]),
    buildNumbers.length
      ? fetch(supabaseUrl(`build_transactions?select=id,build_number&build_number=in.(${buildNumbers.map((n) => `"${n}"`).join(",")})`), { headers: supabaseHeaders(accessToken) }).then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; build_number: string }>>) : []))
      : Promise.resolve([]),
  ]);

  const itemIdBySku = new Map(itemRows.map((row) => [row.sku, row.id]));
  const projectIdByName = new Map(projectRows.map((row) => [row.project_name, row.id]));
  const buildIdByNumber = new Map(buildRows.map((row) => [row.build_number, row.id]));

  const payload = movements
    .map((movement) => {
      const inventoryItemId = itemIdBySku.get(movement.sku);
      if (!inventoryItemId) {
        return null;
      }
      return {
        legacy_id: movement.id,
        movement_type: pgMovementType(movement.type),
        inventory_item_id: inventoryItemId,
        quantity: movement.quantity,
        project_id: movement.projectName ? projectIdByName.get(movement.projectName) ?? null : null,
        reference_number: movement.poNumber ?? null,
        build_transaction_id: movement.buildNumber ? buildIdByNumber.get(movement.buildNumber) ?? null : null,
        movement_date: movement.createdAt,
        balance_before: movement.quantityBefore,
        balance_after: movement.quantityAfter,
        notes: movement.notes,
        created_at: movement.createdAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (payload.length === 0) {
    return;
  }
  await fetch(supabaseUrl("inventory_movements?on_conflict=legacy_id"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(payload),
  });
}

export async function saveProjectAllocations(allocations: ProjectAllocationHistory[], accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken || allocations.length === 0) {
    return;
  }
  const skus = Array.from(new Set(allocations.map((a) => a.sku).filter(Boolean)));
  const projectNames = Array.from(new Set(allocations.map((a) => a.projectName).filter(Boolean)));
  const movementLegacyIds = Array.from(new Set(allocations.map((a) => a.movementId).filter(Boolean)));

  const [itemRows, projectRows, movementRows] = await Promise.all([
    skus.length
      ? fetch(supabaseUrl(`inventory_items?select=id,sku&sku=in.(${skus.map((s) => `"${s}"`).join(",")})`), { headers: supabaseHeaders(accessToken) }).then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; sku: string }>>) : []))
      : Promise.resolve([]),
    projectNames.length
      ? fetch(supabaseUrl(`projects?select=id,project_name&project_name=in.(${projectNames.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(",")})`), { headers: supabaseHeaders(accessToken) }).then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; project_name: string }>>) : []))
      : Promise.resolve([]),
    movementLegacyIds.length
      ? fetch(supabaseUrl(`inventory_movements?select=id,legacy_id&legacy_id=in.(${movementLegacyIds.map((id) => `"${id}"`).join(",")})`), { headers: supabaseHeaders(accessToken) }).then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; legacy_id: string }>>) : []))
      : Promise.resolve([]),
  ]);

  const itemIdBySku = new Map(itemRows.map((row) => [row.sku, row.id]));
  const projectIdByName = new Map(projectRows.map((row) => [row.project_name, row.id]));
  const movementIdByLegacyId = new Map(movementRows.map((row) => [row.legacy_id, row.id]));

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
  await fetch(supabaseUrl("project_allocation_history?on_conflict=legacy_id"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(payload),
  });
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
};

export type ProjectSite = {
  ref: string;
  name: string;
  client: string;
  type: "Parking Garage" | "Surface Lot" | "Campus Parking" | "Mixed Parking";
  address: string;
  owner: string;
  status: "Draft" | "Planning" | "Procurement" | "Staging" | "Install Ready";
  due: string;
  package: string;
  cameras: number;
  allocated: number;
  siteNotes: string;
  salesQuoteFile?: string;
  sow: ScopeOfWork;
  bom: BomLine[];
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
  item_name: string;
  qty: number | string;
  status: string;
  request_speed: string;
  po: string | null;
  notes: string | null;
  line_sort: number;
  procurement_track: string | null;
  purchasing_sent_at: string | null;
};

type ProjectSiteRow = {
  project_name: string;
  project_number: string | null;
  customer_name: string | null;
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
};

const PROJECT_SITE_SELECT =
  "project_name,project_number,customer_name,site_type,site_address,owner_name,app_status,target_date_display,solution_package,camera_count,allocated_amount,sales_quote_file,notes,project_scope_of_work(summary,preparation,infrastructure,installation,commissioning,fine_tuning,assumptions,exclusions),project_bom_lines(item_name,qty,status,request_speed,po,notes,line_sort,procurement_track,purchasing_sent_at)";

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
      item: line.item_name,
      qty: Number(line.qty) || 0,
      status: (line.status as BomLine["status"]) ?? "Not started",
      requestSpeed: (line.request_speed as BomLine["requestSpeed"]) ?? "Standard",
      po: line.po ?? undefined,
      notes: line.notes ?? undefined,
      procurementTrack: (line.procurement_track as BomLine["procurementTrack"]) ?? "warehouse_stock",
      sentToPurchasingAt: line.purchasing_sent_at ?? null,
    }));
  return {
    ref: row.project_number ?? "",
    name: row.project_name,
    client: row.customer_name ?? "",
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
  };
}

export async function loadProjectSites(accessToken?: string): Promise<ProjectSite[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl(`projects?select=${PROJECT_SITE_SELECT}&order=project_name.asc`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as ProjectSiteRow[];
  return rows.map(mapProjectSiteRow);
}

export async function saveProjectSites(sites: ProjectSite[], accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken || sites.length === 0) {
    return;
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
  }));

  const projectResponse = await fetch(supabaseUrl("projects?on_conflict=project_name"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(projectPayload),
  });
  if (!projectResponse.ok) {
    throw new Error(`Could not save projects: ${projectResponse.status}`);
  }
  const savedRows = (await projectResponse.json()) as Array<{ id: string; project_name: string }>;
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
    await fetch(supabaseUrl("project_scope_of_work?on_conflict=project_id"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(scopePayload),
    });
  }

  // BOM lines have no natural per-line key to reconcile against (same
  // limitation the original migration noted), so each save wholesale
  // replaces a project's line set: resolve item names to inventory_item_id
  // in bulk, delete the project's existing lines, then re-insert current ones.
  const itemNames = new Set<string>();
  sites.forEach((site) => site.bom.forEach((line) => itemNames.add(line.item)));
  const itemRows = itemNames.size
    ? await fetch(
        supabaseUrl(`inventory_items?select=id,item_name&item_name=in.(${Array.from(itemNames).map((n) => `"${n.replace(/"/g, '\\"')}"`).join(",")})`),
        { headers: supabaseHeaders(accessToken) },
      ).then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; item_name: string }>>) : []))
    : [];
  const itemIdByName = new Map(itemRows.map((row) => [row.item_name, row.id]));

  const projectIds = sites.map((site) => idByName.get(site.name)).filter((id): id is string => Boolean(id));
  if (projectIds.length > 0) {
    await fetch(supabaseUrl(`project_bom_lines?project_id=in.(${projectIds.join(",")})`), {
      method: "DELETE",
      headers: supabaseHeaders(accessToken),
    });
  }

  const bomPayload = sites.flatMap((site) => {
    const projectId = idByName.get(site.name);
    if (!projectId) {
      return [];
    }
    return site.bom.map((line, index) => ({
      project_id: projectId,
      item_name: line.item,
      inventory_item_id: itemIdByName.get(line.item) ?? null,
      qty: line.qty,
      status: line.status,
      request_speed: line.requestSpeed,
      po: line.po || null,
      notes: line.notes || null,
      line_sort: index,
      procurement_track: line.procurementTrack ?? "warehouse_stock",
      purchasing_sent_at: line.sentToPurchasingAt ?? null,
    }));
  });

  if (bomPayload.length > 0) {
    await fetch(supabaseUrl("project_bom_lines"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=minimal" },
      body: JSON.stringify(bomPayload),
    });
  }
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

export async function restoreFullBackupSnapshot(snapshot: Partial<FullBackupSnapshot>, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  // Order matters, same dependency chain as the live debounce-save effects:
  // inventory items and equipment recipes first (BOM lines/components
  // resolve item names against them), then projects (BOM lines resolve
  // against inventory items too), then purchase requests and documents
  // (independent of the above), then builds -> movements -> allocations
  // last (each resolves ids from the one before it).
  if (snapshot.inventoryItems?.length) {
    await saveInventoryItems(snapshot.inventoryItems, accessToken);
  }
  if (snapshot.deviceRecipes?.length) {
    await saveDeviceRecipes(snapshot.deviceRecipes, accessToken);
  }
  if (snapshot.projectSites?.length) {
    await saveProjectSites(snapshot.projectSites, accessToken);
  }
  if (snapshot.purchaseRequests?.length) {
    await saveRestoredPurchaseRequests(snapshot.purchaseRequests, accessToken);
  }
  if (snapshot.projectDocuments?.length) {
    await saveRestoredProjectDocuments(snapshot.projectDocuments, accessToken);
  }
  if (snapshot.buildTransactions?.length || snapshot.inventoryMovements?.length || snapshot.projectAllocations?.length) {
    await saveMovementsBuildsAllocations(
      snapshot.buildTransactions ?? [],
      snapshot.inventoryMovements ?? [],
      snapshot.projectAllocations ?? [],
      accessToken,
    );
  }
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
  await fetch(supabaseUrl("purchase_requests?on_conflict=id"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(payload),
  });
}

async function saveRestoredProjectDocuments(docs: ProjectDocument[], accessToken: string): Promise<void> {
  const payload = docs.map((doc, index) => ({
    id: doc.id,
    document_number: `DOC-RESTORE-${Date.now().toString(36).toUpperCase()}-${index}`,
    project_name: doc.project || null,
    document_type: appDocumentType(doc.type),
    file_name: doc.name,
    file_size_bytes: doc.size,
    status: pgDocumentStatus(doc.status),
    storage_status: pgDocumentStorage(doc.storage),
    storage_provider: doc.storage === "Supabase Storage" ? "supabase_storage" : "browser",
    file_url: doc.storagePath ?? null,
    uploaded_at: doc.uploadedAt ?? new Date().toISOString(),
  }));
  await fetch(supabaseUrl("project_documents?on_conflict=id"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(payload),
  });
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
  name: string;
  category: PurchaseLineCategory;
  qty: number;
  unitCost: number;
  lineTotal?: number;
};

export type PurchaseOrder = {
  id: string;
  number: string;
  vendor: string;
  date: string;
  projectRef: string;
  status: "Imported" | "In Processing" | "On Hold";
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  sourceFile: string;
  shipTo: string;
  paymentNote: string;
  lines: PurchaseOrderLine[];
};

type PurchaseOrderLineRow = {
  item_name: string;
  category: string | null;
  quantity_ordered: number | string;
  unit_cost: number | string;
  line_total: number | string | null;
};

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
};

function appPoCategory(category: string | null): PurchaseLineCategory {
  const allowed: PurchaseLineCategory[] = ["Compute", "Storage", "Network", "Power", "Enclosure", "Hardware", "Rack", "Other"];
  return (allowed as string[]).includes(category ?? "") ? (category as PurchaseLineCategory) : "Other";
}

function pgPoStatus(status: PurchaseOrder["status"]): string {
  switch (status) {
    case "In Processing": return "ordered";
    case "On Hold": return "submitted";
    default: return "received";
  }
}

function mapPurchaseOrderLineRow(row: PurchaseOrderLineRow): PurchaseOrderLine {
  return {
    name: row.item_name,
    category: appPoCategory(row.category),
    qty: Number(row.quantity_ordered) || 0,
    unitCost: Number(row.unit_cost) || 0,
    lineTotal: row.line_total !== null ? Number(row.line_total) || undefined : undefined,
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
    status: row.app_status === "In Processing" || row.app_status === "On Hold" ? row.app_status : "Imported",
    subtotal,
    tax,
    shipping,
    total: row.total_amount !== null && row.total_amount !== undefined ? Number(row.total_amount) || subtotal + tax + shipping : subtotal + tax + shipping,
    sourceFile: row.source_file ?? "",
    shipTo: row.ship_to ?? "",
    paymentNote: row.payment_note ?? "",
    lines: (row.purchase_order_lines ?? []).map(mapPurchaseOrderLineRow),
  };
}

const PURCHASE_ORDER_SELECT =
  "id,po_number,app_status,requested_date,subtotal,tax_amount,shipping_amount,total_amount,project_name,ship_to,payment_note,source_file,vendor:vendors(name),purchase_order_lines(item_name,category,quantity_ordered,unit_cost,line_total)";

export async function loadPurchaseOrders(accessToken?: string): Promise<PurchaseOrder[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl(`purchase_orders?select=${PURCHASE_ORDER_SELECT}&order=requested_date.desc`), {
    headers: supabaseHeaders(accessToken),
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as PurchaseOrderRow[];
  return rows.map(mapPurchaseOrderRow);
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
  };
  const orderResponse = await fetch(supabaseUrl("purchase_orders"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify(orderPayload),
  });
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
  let lineRows: PurchaseOrderLineRow[] = [];
  if (linePayload.length > 0) {
    const lineResponse = await fetch(supabaseUrl("purchase_order_lines"), {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
      body: JSON.stringify(linePayload),
    });
    if (lineResponse.ok) {
      lineRows = (await lineResponse.json()) as PurchaseOrderLineRow[];
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
    lines: lineRows.length > 0 ? lineRows.map(mapPurchaseOrderLineRow) : input.lines.map((line) => ({ ...line })),
  };
}

export async function updatePurchaseOrderStatus(id: string, status: PurchaseOrder["status"], accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`purchase_orders?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ app_status: status, status: pgPoStatus(status) }),
  });
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
};

// Migration 056: an addable Sign/Space Sensor/Misc line at a specific
// location -- always tied to a real catalog item (unlike the quote-level
// BOM lines, which allow free text for labor/service rows), so the
// dropdown for these is always populated from the catalog, filtered
// differently per lineType in the UI.
export type SalesQuoteLocationItem = {
  id: string;
  quoteLocationId: string;
  lineType: "sign" | "sensor" | "misc";
  catalogItemId: string | null;
  qty: number;
  lineSort: number;
};

export type SalesQuoteLocation = {
  id: string;
  quoteId: string;
  locationType: "garage" | "lot";
  name: string;
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
  clientName: string;
  siteName: string;
  city: string;
  createdByEmail: string;
  createdAt: string;
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
};

type SalesQuoteLocationImageRow = {
  id: string;
  image_type: string;
  storage_path: string;
  file_name: string | null;
  description: string | null;
  uploaded_at: string;
};

type SalesQuoteLocationItemRow = {
  id: string;
  quote_location_id: string;
  line_type: string;
  catalog_item_id: string | null;
  qty: number | string;
  line_sort: number;
};

type SalesQuoteLocationRow = {
  id: string;
  quote_id: string;
  location_type: string;
  name: string;
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
  client_name: string;
  site_name: string;
  city: string | null;
  created_by_email: string | null;
  created_at: string;
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
};

function mapSalesQuoteLocationImageRow(row: SalesQuoteLocationImageRow): SalesQuoteLocationImage {
  return {
    id: row.id,
    imageType: row.image_type === "drawing" ? "drawing" : "photo",
    storagePath: row.storage_path,
    fileName: row.file_name ?? "",
    description: row.description ?? "",
    uploadedAt: row.uploaded_at,
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
  };
}

function mapSalesQuoteLocationRow(row: SalesQuoteLocationRow): SalesQuoteLocation {
  const items = (row.sales_quote_location_items ?? []).map(mapSalesQuoteLocationItemRow).sort((a, b) => a.lineSort - b.lineSort);
  return {
    id: row.id,
    quoteId: row.quote_id,
    locationType: row.location_type === "lot" ? "lot" : "garage",
    name: row.name,
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
    clientName: row.client_name,
    siteName: row.site_name,
    city: row.city ?? "",
    createdByEmail: row.created_by_email ?? "",
    createdAt: row.created_at,
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
  };
}

const SALES_QUOTE_SELECT =
  "id,client_name,site_name,city,created_by_email,created_at,status,client_email,proposal_summary,contact_full_name,contact_phone,preferred_communication,site_street_address,site_state,site_zip,client_street_address,client_city,client_state,client_zip,sales_quote_locations(id,quote_id,location_type,name,line_sort,fli,lpr,people_counting,fli_camera_item_id,lpr_camera_item_id,people_counting_camera_item_id,entries_count,exits_count,levels_count,sales_quote_location_images(id,image_type,storage_path,file_name,description,uploaded_at),sales_quote_location_items(id,quote_location_id,line_type,catalog_item_id,qty,line_sort)),sales_quote_bom_lines(id,quote_id,item_name,qty,notes,line_sort,catalog_item_id,source_location_id)";

export async function loadSalesQuotes(accessToken?: string): Promise<SalesQuote[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }
  const response = await fetch(supabaseUrl(`sales_quotes?select=${SALES_QUOTE_SELECT}&order=created_at.desc`), {
    headers: supabaseHeaders(accessToken),
  });
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
  const quoteRows = (await quoteResponse.json()) as Array<{ id: string }>;
  const quoteId = quoteRows[0]?.id;
  if (!quoteId) {
    return null;
  }

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
    clientName: input.clientName,
    siteName: input.siteName,
    city: input.city,
    createdByEmail: input.createdByEmail,
    createdAt: new Date().toISOString(),
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
  };
}

export async function updateSalesQuoteStatus(id: string, status: SalesQuote["status"], accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`sales_quotes?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ status }),
  });
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
export async function deleteSalesQuoteBomLinesByLocationSource(quoteId: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`sales_quote_bom_lines?quote_id=eq.${quoteId}&source_location_id=not.is.null`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });
}

export async function updateSalesQuoteBomLineCatalogLink(id: string, catalogItemId: string | null, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`sales_quote_bom_lines?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ catalog_item_id: catalogItemId }),
  });
}

export async function deleteSalesQuoteBomLine(id: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`sales_quote_bom_lines?id=eq.${id}`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });
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
  if (updates.fli !== undefined) payload.fli = updates.fli;
  if (updates.lpr !== undefined) payload.lpr = updates.lpr;
  if (updates.peopleCounting !== undefined) payload.people_counting = updates.peopleCounting;
  if (updates.fliCameraItemId !== undefined) payload.fli_camera_item_id = updates.fliCameraItemId;
  if (updates.lprCameraItemId !== undefined) payload.lpr_camera_item_id = updates.lprCameraItemId;
  if (updates.peopleCountingCameraItemId !== undefined) payload.people_counting_camera_item_id = updates.peopleCountingCameraItemId;
  if (updates.entriesCount !== undefined) payload.entries_count = updates.entriesCount;
  if (updates.exitsCount !== undefined) payload.exits_count = updates.exitsCount;
  if (updates.levelsCount !== undefined) payload.levels_count = updates.levelsCount;
  await fetch(supabaseUrl(`sales_quote_locations?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
}

// Migration 056: addable Sign/Space Sensor/Misc lines at a location.
export async function addSalesQuoteLocationItem(
  quoteLocationId: string,
  lineType: SalesQuoteLocationItem["lineType"],
  catalogItemId: string,
  qty: number,
  lineSort: number,
  accessToken?: string,
): Promise<SalesQuoteLocationItem | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const response = await fetch(supabaseUrl("sales_quote_location_items"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ quote_location_id: quoteLocationId, line_type: lineType, catalog_item_id: catalogItemId, qty, line_sort: lineSort }),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as SalesQuoteLocationItemRow[];
  return rows[0] ? mapSalesQuoteLocationItemRow(rows[0]) : null;
}

export async function updateSalesQuoteLocationItemQty(id: string, qty: number, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`sales_quote_location_items?id=eq.${id}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ qty }),
  });
}

export async function deleteSalesQuoteLocationItem(id: string, accessToken?: string): Promise<void> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }
  await fetch(supabaseUrl(`sales_quote_location_items?id=eq.${id}`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });
}

const SALES_QUOTE_IMAGE_BUCKET = "sales-quote-images";

export function buildQuoteImageStoragePath(quoteLocationId: string, fileName: string): string {
  const stamp = Date.now().toString(36);
  return `${quoteLocationId}/${stamp}-${sanitizeStoragePathSegment(fileName)}`;
}

export async function uploadQuoteImageFile(file: File, storagePath: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
  const response = await fetch(
    `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/${SALES_QUOTE_IMAGE_BUCKET}/${storagePath}`,
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

export async function getQuoteImageDownloadUrl(storagePath: string, accessToken?: string): Promise<string | null> {
  if (!isRemotePersistenceConfigured() || !accessToken || !storagePath) {
    return null;
  }
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
  const response = await fetch(
    `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/storage/v1/object/sign/${SALES_QUOTE_IMAGE_BUCKET}/${storagePath}`,
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

export async function addSalesQuoteLocationImage(
  quoteLocationId: string,
  imageType: "photo" | "drawing",
  file: File,
  accessToken?: string,
  description?: string,
): Promise<SalesQuoteLocationImage | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }
  const storagePath = buildQuoteImageStoragePath(quoteLocationId, file.name);
  const uploaded = await uploadQuoteImageFile(file, storagePath, accessToken);
  if (!uploaded) {
    return null;
  }
  const response = await fetch(supabaseUrl("sales_quote_location_images"), {
    method: "POST",
    headers: { ...supabaseHeaders(accessToken), prefer: "return=representation" },
    body: JSON.stringify({ quote_location_id: quoteLocationId, image_type: imageType, storage_path: storagePath, file_name: file.name, description: description || null }),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as SalesQuoteLocationImageRow[];
  return rows[0] ? mapSalesQuoteLocationImageRow(rows[0]) : null;
}

export async function updateSalesQuoteLocationImageDescription(imageId: string, description: string, accessToken?: string): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return false;
  }
  const response = await fetch(supabaseUrl(`sales_quote_location_images?id=eq.${imageId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ description: description || null }),
  });
  return response.ok;
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

export async function fetchPublicQuoteProposal(token: string): Promise<PublicQuoteProposalView | null> {
  if (!isRemotePersistenceConfigured() || !token) {
    return null;
  }
  const response = await fetch(supabaseUrl("rpc/get_quote_proposal_by_token"), {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify({ share_token: token }),
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as Array<{
    proposal_id: string;
    status: string;
    version: number;
    content_snapshot: ProposalSnapshot;
    client_name: string | null;
  }>;
  if (!rows.length) {
    return null;
  }
  const row = rows[0];
  return {
    proposalId: row.proposal_id,
    status: row.status as SalesQuoteProposal["status"],
    version: row.version,
    contentSnapshot: row.content_snapshot,
    clientName: row.client_name ?? "",
  };
}

export async function respondToPublicQuoteProposal(
  token: string,
  newStatus: "approved" | "rejected" | "revision_requested",
  approverName: string,
  notes: string,
): Promise<boolean> {
  if (!isRemotePersistenceConfigured() || !token) {
    return false;
  }
  const response = await fetch(supabaseUrl("rpc/respond_to_quote_proposal"), {
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
  return response.ok;
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
  if (Object.keys(payload).length === 0) {
    return;
  }
  await fetch(supabaseUrl(`sales_quotes?id=eq.${quoteId}`), {
    method: "PATCH",
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify(payload),
  });
}
