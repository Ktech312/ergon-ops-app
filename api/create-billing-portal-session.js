// Creates a Stripe Customer Portal session for the caller's own workspace -- a workspace admin
// manages their plan, payment method, and invoices entirely on Stripe's own hosted UI (Q5.3),
// including recovering from a past_due/unpaid state. Deliberately resolves via
// get_my_billing_context() (migration 221), not resolve_caller_workspace_id() -- this endpoint
// must keep working for an ALREADY-blocked workspace, since fixing payment is the whole reason
// an admin would be here.

import { requireAuth } from "./_lib/requireAuth.js";
import { checkRateLimit } from "./_lib/rateLimit.js";
import { getStripeClient } from "./_lib/stripeClient.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to create a billing portal session." });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }
  if (!(await checkRateLimit(`create-billing-portal-session:${user.id}`, 10, 60_000))) {
    res.status(429).json({ error: "Too many billing requests -- please slow down." });
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    res.status(200).json({ error: "Not configured." });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const callerHeaders = { apikey: anonKey, authorization: `Bearer ${callerToken}`, "content-type": "application/json" };

  const ctxResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/get_my_billing_context`, {
    method: "POST",
    headers: callerHeaders,
    body: JSON.stringify({}),
  });
  if (!ctxResponse.ok) {
    res.status(403).json({ error: "Could not resolve your workspace." });
    return;
  }
  const ctxRows = await ctxResponse.json();
  const ctx = ctxRows[0];
  if (!ctx) {
    res.status(403).json({ error: "Could not resolve your workspace." });
    return;
  }
  if (!ctx.is_admin) {
    res.status(403).json({ error: "Only a workspace admin may manage billing." });
    return;
  }
  if (!ctx.stripe_customer_id) {
    res.status(200).json({ error: "This workspace has no billing account yet -- start a subscription first." });
    return;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(200).json({ error: "Billing is not configured." });
    return;
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: ctx.stripe_customer_id,
      return_url: `${origin}/#admin`,
    });
    res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("[create-billing-portal-session] Stripe error:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Could not open the billing portal." });
  }
}
