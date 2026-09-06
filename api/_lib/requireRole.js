// Security review, 2026-09-06 (E: "Audit every api/*.js route for
// authorization and abuse risk... many only establish that the caller
// is signed in.") -- requireAuth.js proves "a real logged-in Ergon
// user," but several routes (invites, arbitrary-recipient email,
// arbitrary Slack DM, arbitrary-userId push) had no per-role check at
// all, and send-push in particular used the Supabase service-role key
// to act on ANY user id the caller supplied with ANY title/body --
// any signed-in account, including a brand-new unapproved one, could
// have pushed fabricated content to any teammate's phone.
//
// This mirrors the client's own role-check pattern (checkIsAdmin/
// loadOwnRoleKeys in persistence.ts) rather than inventing a new one --
// same tables (app_admins, app_user_roles), same RLS, queried with the
// CALLER'S OWN access token (never the service-role key), so a route
// can never see more than the calling user could already see about
// themselves.

export async function loadCallerAuthorization(userId, accessToken) {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { isAdmin: false, roleKeys: [] };
  }
  const headers = { apikey: anonKey, authorization: `Bearer ${accessToken}` };

  async function safeRows(path) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
      if (!response.ok) {
        return [];
      }
      return await response.json();
    } catch {
      return [];
    }
  }

  const [adminRows, roleRows] = await Promise.all([
    safeRows(`app_admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id`),
    safeRows(`app_user_roles?user_id=eq.${encodeURIComponent(userId)}&select=role_key`),
  ]);

  return {
    isAdmin: adminRows.length > 0,
    roleKeys: roleRows.map((row) => row.role_key),
  };
}

// Call after requireAuth already confirmed a real signed-in user. Pass
// the roles allowed to proceed (besides admin, who can always proceed).
// Writes the 403 itself, same convention as requireAuth's own 401.
export async function requireRole(req, res, user, allowedRoleKeys) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const { isAdmin, roleKeys } = await loadCallerAuthorization(user.id, token);
  if (isAdmin || roleKeys.some((key) => allowedRoleKeys.includes(key))) {
    return true;
  }
  res.status(403).json({ error: "You don't have permission to do that." });
  return false;
}
