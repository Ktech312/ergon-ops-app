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

  const response = await fetch(supabaseUrl(`app_user_roles?user_id=eq.${userId}&select=role_key&limit=1`), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return null;
  }

  const rows = (await response.json()) as Array<{ role_key?: string }>;
  return rows[0]?.role_key ?? null;
}

export async function loadOwnAllowedViews(userId: string, accessToken?: string): Promise<string[] | null> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return null;
  }

  const response = await fetch(supabaseUrl(`app_user_roles?user_id=eq.${userId}&select=allowed_views&limit=1`), {
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

  const response = await fetch(supabaseUrl(`app_user_roles?user_id=eq.${userId}`), {
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

export async function loadAllUserRoles(accessToken?: string): Promise<Record<string, string>> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return {};
  }

  const response = await fetch(supabaseUrl("app_user_roles?select=user_id,role_key"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return {};
  }

  const rows = (await response.json()) as Array<{ user_id: string; role_key: string }>;
  const map: Record<string, string> = {};
  rows.forEach((row) => {
    map[row.user_id] = row.role_key;
  });
  return map;
}

export async function loadAllAllowedViews(accessToken?: string): Promise<Record<string, string[] | null>> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return {};
  }

  const response = await fetch(supabaseUrl("app_user_roles?select=user_id,allowed_views"), {
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
  };
}

export function makeCatalogNumber() {
  return `CAT-${Date.now().toString(36).toUpperCase()}`;
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
    body: JSON.stringify({
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
    }),
  });

  if (!response.ok) {
    throw new Error(`Could not create catalog item: ${response.status}`);
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
      retired_at: item.isRetired ? new Date().toISOString() : null,
    }),
  });

  if (!response.ok) {
    throw new Error(`Could not update catalog item: ${response.status}`);
  }

  const rows = (await response.json()) as CatalogItemRow[];
  return mapCatalogRow(rows[0]);
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

export type ApprovalStatus = "pending" | "approved" | "denied";

export type UserStatus = {
  userId: string;
  approvalStatus: ApprovalStatus;
  expiresAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  requestedAt: string;
};

type UserStatusRow = {
  user_id: string;
  approval_status: ApprovalStatus;
  expires_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  requested_at: string;
};

function mapUserStatusRow(row: UserStatusRow): UserStatus {
  return {
    userId: row.user_id,
    approvalStatus: row.approval_status,
    expiresAt: row.expires_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    requestedAt: row.requested_at,
  };
}

// Creates a pending-approval row for the current user if one doesn't already
// exist. Safe to call every sign-in: a 409 conflict on the unique user_id just
// means the row is already there, which is not an error worth surfacing.
export async function ensureOwnApprovalRequest(userId: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  await fetch(supabaseUrl("app_user_status"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "resolution=ignore-duplicates",
    },
    body: JSON.stringify({ user_id: userId }),
  }).catch(() => undefined);
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

export type TaskSection = "warehouse" | "purchasing" | "inventory" | "projects" | "sales" | "engineering" | "general";
export type TaskStatus = "to_do" | "in_progress" | "ready_for_review" | "done" | "blocked";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export type EOTask = {
  id: string;
  taskNumber: string;
  title: string;
  description: string;
  section: TaskSection;
  projectRef: string;
  isInternal: boolean;
  status: TaskStatus;
  priority: TaskPriority;
  category: string;
  impactAreas: string[];
  assigneeUserId: string | null;
  assigneeEmail: string;
  dueDate: string;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
};

type TaskRow = {
  id: string;
  task_number: string;
  title: string;
  description: string | null;
  section: TaskSection;
  project_ref: string | null;
  is_internal: boolean;
  status: TaskStatus;
  priority: TaskPriority;
  category: string | null;
  impact_areas: string[] | null;
  assignee_user_id: string | null;
  assignee_email: string | null;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
};

function mapTaskRow(row: TaskRow): EOTask {
  return {
    id: row.id,
    taskNumber: row.task_number,
    title: row.title,
    description: row.description ?? "",
    section: row.section,
    projectRef: row.project_ref ?? "",
    isInternal: row.is_internal,
    status: row.status,
    priority: row.priority,
    category: row.category ?? "",
    impactAreas: row.impact_areas ?? [],
    assigneeUserId: row.assignee_user_id,
    assigneeEmail: row.assignee_email ?? "",
    dueDate: row.due_date ?? "",
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function makeTaskNumber() {
  return `TASK-${Date.now().toString(36).toUpperCase()}`;
}

export async function loadTasks(accessToken?: string): Promise<EOTask[]> {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return [];
  }

  const response = await fetch(supabaseUrl("tasks?select=*&order=created_at.desc"), {
    headers: supabaseHeaders(accessToken),
  });

  if (!response.ok) {
    return [];
  }

  const rows = (await response.json()) as TaskRow[];
  return rows.map(mapTaskRow);
}

export async function createTask(
  task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdAt" | "completedAt">,
  createdBy: string,
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
      is_internal: task.isInternal,
      status: task.status,
      priority: task.priority,
      category: task.category,
      impact_areas: task.impactAreas,
      assignee_email: task.assigneeEmail || null,
      due_date: task.dueDate || null,
      created_by: createdBy,
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
  if (task.isInternal !== undefined) payload.is_internal = task.isInternal;
  if (task.status !== undefined) {
    payload.status = task.status;
    payload.completed_at = task.status === "done" ? new Date().toISOString() : null;
  }
  if (task.priority !== undefined) payload.priority = task.priority;
  if (task.category !== undefined) payload.category = task.category;
  if (task.impactAreas !== undefined) payload.impact_areas = task.impactAreas;
  if (task.assigneeEmail !== undefined) payload.assignee_email = task.assigneeEmail || null;
  if (task.dueDate !== undefined) payload.due_date = task.dueDate || null;

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

export async function deleteTask(id: string, accessToken?: string) {
  if (!isRemotePersistenceConfigured() || !accessToken) {
    return;
  }

  await fetch(supabaseUrl(`tasks?id=eq.${id}`), {
    method: "DELETE",
    headers: supabaseHeaders(accessToken),
  });
}

export type TeamMember = {
  id: string;
  fullName: string;
  email: string;
  roleTitle: string;
  isActive: boolean;
};

type TeamMemberRow = {
  id: string;
  full_name: string;
  email: string | null;
  role_title: string | null;
  is_active: boolean;
};

function mapTeamMemberRow(row: TeamMemberRow): TeamMember {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email ?? "",
    roleTitle: row.role_title ?? "",
    isActive: row.is_active,
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

export async function createNotification(
  notification: { recipientEmail: string; eventType: string; title: string; body: string; relatedEntityType?: string; relatedEntityId?: string; dedupeKey?: string },
  accessToken?: string,
) {
  if (!isRemotePersistenceConfigured() || !accessToken || !notification.recipientEmail) {
    return;
  }

  await fetch(supabaseUrl("notifications"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      prefer: "resolution=ignore-duplicates",
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
