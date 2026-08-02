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

const LOCAL_STATE_KEY = "ergon:app-state:v1";
const WORKSPACE_KEY = "default";

function envValue(key: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY") {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.[key] ?? "";
}

export function isRemotePersistenceConfigured() {
  return Boolean(envValue("VITE_SUPABASE_URL") && envValue("VITE_SUPABASE_ANON_KEY"));
}

function supabaseHeaders() {
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
  return {
    apikey: anonKey,
    authorization: `Bearer ${anonKey}`,
    "content-type": "application/json",
  };
}

function supabaseUrl(path: string) {
  return `${envValue("VITE_SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${path}`;
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

export async function loadRemoteAppState(): Promise<PersistedAppState | null> {
  if (!isRemotePersistenceConfigured()) {
    return null;
  }

  const response = await fetch(supabaseUrl(`app_state_snapshots?workspace_key=eq.${WORKSPACE_KEY}&select=state&limit=1`), {
    headers: supabaseHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Supabase load failed: ${response.status}`);
  }

  const rows = (await response.json()) as Array<{ state?: PersistedAppState }>;
  return rows[0]?.state ?? null;
}

export async function saveRemoteAppState(state: PersistedAppState) {
  if (!isRemotePersistenceConfigured()) {
    return;
  }

  const response = await fetch(supabaseUrl("app_state_snapshots?on_conflict=workspace_key"), {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      workspace_key: WORKSPACE_KEY,
      state,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Supabase save failed: ${response.status}`);
  }

  void fetch(supabaseUrl("app_sync_events"), {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify({
      workspace_key: WORKSPACE_KEY,
      event_type: "snapshot_save",
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
