export type PersistedAppState = {
  inventoryItems: unknown[];
  projectSites: unknown[];
  deviceRecipes: unknown[];
  inventoryMovements: unknown[];
  buildTransactions: unknown[];
  projectAllocations: unknown[];
  purchaseRequests: unknown[];
  projectDocuments: unknown[];
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
const STATE_KEYS: Array<keyof PersistedAppState> = [
  "inventoryItems",
  "projectSites",
  "deviceRecipes",
  "inventoryMovements",
  "buildTransactions",
  "projectAllocations",
  "purchaseRequests",
  "projectDocuments",
  "roleMode",
];

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
    inventoryItems: Array.isArray(byKey.get("inventoryItems")) ? (byKey.get("inventoryItems") as unknown[]) : [],
    projectSites: Array.isArray(byKey.get("projectSites")) ? (byKey.get("projectSites") as unknown[]) : [],
    deviceRecipes: Array.isArray(byKey.get("deviceRecipes")) ? (byKey.get("deviceRecipes") as unknown[]) : [],
    inventoryMovements: Array.isArray(byKey.get("inventoryMovements")) ? (byKey.get("inventoryMovements") as unknown[]) : [],
    buildTransactions: Array.isArray(byKey.get("buildTransactions")) ? (byKey.get("buildTransactions") as unknown[]) : [],
    projectAllocations: Array.isArray(byKey.get("projectAllocations")) ? (byKey.get("projectAllocations") as unknown[]) : [],
    purchaseRequests: Array.isArray(byKey.get("purchaseRequests")) ? (byKey.get("purchaseRequests") as unknown[]) : [],
    projectDocuments: Array.isArray(byKey.get("projectDocuments")) ? (byKey.get("projectDocuments") as unknown[]) : [],
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

  const response = await fetch(supabaseUrl(`app_user_roles?user_id=eq.${userId}&select=role_key&limit=1`), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return null;
  }

  const rows = (await response.json()) as Array<{ role_key?: string }>;
  return rows[0]?.role_key ?? null;
}

export async function saveUserRoleMode(userId: string, roleKey: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  await fetch(supabaseUrl("app_user_roles?on_conflict=user_id"), {
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
        inventory_items: state.inventoryItems.length,
        projects: state.projectSites.length,
        equipment_recipes: state.deviceRecipes.length,
        movements: state.inventoryMovements.length,
        builds: state.buildTransactions.length,
        purchase_requests: state.purchaseRequests.length,
        project_documents: state.projectDocuments.length,
      },
    }),
  }).catch(() => {
    // Snapshot save already succeeded; event logging should not block the app.
  });
}
