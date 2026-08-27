// Every route in api/ used to be fully public -- no check of any kind on
// who was calling it. Confirmed 2026-08-27 during a security review E
// asked for after a real incident on the VLTD sister project: an
// unauthenticated POST to send-invite-email (or the other mailer routes)
// let anyone on the internet use this app's own trusted Gmail/Resend
// sender to blast an email with an attacker-controlled link to any
// address -- a phishing vector riding on a real business's sending
// reputation, not just "spam." send-push and sales-quote-extract had the
// same shape (spam a stranger's phone / burn OpenAI credits and server
// compute on arbitrary uploads). This repo is public on GitHub, so this
// isn't a theoretical risk -- anyone can read exactly how to call these.
//
// Fix: every route the client calls already has a real Supabase access
// token (the user is logged in to use the app at all) -- require it here
// and verify it against Supabase's own /auth/v1/user endpoint before
// doing anything. No new secrets needed; VITE_SUPABASE_URL/
// VITE_SUPABASE_ANON_KEY are already set for the client build and are
// readable by any Vercel serverless function regardless of the VITE_
// prefix. This only proves "a real logged-in Ergon user is asking," not
// role/permission -- these routes don't have per-role logic to enforce
// today, and that's a reasonable trust boundary for outbound-mail/push
// plumbing (the same boundary the rest of the app relies on via RLS
// everywhere else). If a route ever needs admin-only enforcement, layer
// an additional role check on top of this, don't replace it.

export async function requireAuthenticatedUser(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!token || !supabaseUrl || !anonKey) {
    return null;
  }

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return null;
    }
    const user = await response.json();
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

// Call at the top of a handler: `if (!(await requireAuth(req, res))) return;`
// -- writes the 401 itself so every route doesn't repeat that boilerplate.
export async function requireAuth(req, res) {
  const user = await requireAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in required." });
    return null;
  }
  return user;
}
