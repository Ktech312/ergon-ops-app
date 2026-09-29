// Creates a real Stripe Checkout session for the caller's own workspace -- or, per E's own
// correction #4 (2026-09-29, PRODUCT_BILLING_SAAS_DECISIONS.md), redirects to the Customer
// Portal instead if that workspace already has a live subscription, rather than ever letting a
// second Checkout session create a duplicate one (Stripe's own documented guidance:
// https://docs.stripe.com/payments/checkout/limit-subscriptions).
//
// Structurally cannot create a real charge yet, on purpose, per E's explicit instruction to
// "keep production checkout disabled until the prices, caps, module mapping, Stripe Price IDs,
// and tax-readiness are explicitly approved":
//   1. billing_settings.checkout_enabled defaults to false and is checked below -- a hard stop
//      regardless of everything else.
//   2. Even with that flipped on, billing_plans' Stripe Price IDs are all NULL until E enters
//      real commercial values (migration 221's own seed) -- Stripe itself would reject a
//      session creation attempt with no valid price.
// Both are real, independent gates, not just documentation -- either one alone is sufficient to
// keep this endpoint from ever producing a real charge today.

import { requireAuth } from "./_lib/requireAuth.js";
import { checkRateLimit } from "./_lib/rateLimit.js";
import { getStripeClient } from "./_lib/stripeClient.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to create a checkout session." });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }
  if (!(await checkRateLimit(`create-checkout-session:${user.id}`, 10, 60_000))) {
    res.status(429).json({ error: "Too many billing requests -- please slow down." });
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    res.status(200).json({ error: "Not configured." });
    return;
  }

  const { planKey, interval } = req.body || {};
  if (typeof planKey !== "string" || !planKey) {
    res.status(400).json({ error: "planKey is required." });
    return;
  }
  if (interval !== "monthly" && interval !== "annual") {
    res.status(400).json({ error: "interval must be 'monthly' or 'annual'." });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const callerHeaders = { apikey: anonKey, authorization: `Bearer ${callerToken}`, "content-type": "application/json" };

  // Resolves via get_my_billing_context() (migration 221) -- deliberately NOT
  // resolve_caller_workspace_id(), which would raise for an already-blocked workspace and
  // defeat the entire point of this endpoint existing.
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

  // Gate 1: the literal "production checkout disabled" switch.
  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/billing_settings?id=eq.1&select=checkout_enabled`, {
    headers: callerHeaders,
  });
  const settingsRows = settingsResponse.ok ? await settingsResponse.json() : [];
  if (!settingsRows[0]?.checkout_enabled) {
    res.status(200).json({ error: "Checkout is not yet available. Contact your Ergon account team." });
    return;
  }

  // Duplicate-subscription prevention: an existing live subscription redirects to the Portal
  // instead of ever creating a second Checkout session for the same workspace.
  if (ctx.stripe_subscription_id && (ctx.status === "active" || ctx.status === "trialing" || ctx.status === "past_due")) {
    res.status(200).json({ redirectToPortal: true, reason: "This workspace already has a subscription -- manage it from the Billing Portal instead." });
    return;
  }

  const planResponse = await fetch(
    `${supabaseUrl}/rest/v1/billing_plans?plan_key=eq.${encodeURIComponent(planKey)}&is_active=eq.true&select=plan_key,stripe_monthly_price_id,stripe_annual_price_id`,
    { headers: callerHeaders },
  );
  const planRows = planResponse.ok ? await planResponse.json() : [];
  const plan = planRows[0];
  if (!plan) {
    res.status(400).json({ error: "That plan does not exist or is not currently offered." });
    return;
  }
  const priceId = interval === "annual" ? plan.stripe_annual_price_id : plan.stripe_monthly_price_id;
  if (!priceId) {
    // Gate 2: no real Stripe Price ID configured yet for this plan/interval -- the second,
    // independent reason production checkout cannot proceed until E supplies real commercial
    // values, even if checkout_enabled were somehow true.
    res.status(200).json({ error: "This plan is not yet available for checkout -- pricing has not been finalized." });
    return;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(200).json({ error: "Billing is not configured." });
    return;
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: ctx.workspace_id,
      customer: ctx.stripe_customer_id || undefined,
      customer_email: ctx.stripe_customer_id ? undefined : user.email,
      metadata: { workspace_id: ctx.workspace_id },
      subscription_data: { metadata: { workspace_id: ctx.workspace_id } },
      success_url: `${origin}/#admin?billing=success`,
      cancel_url: `${origin}/#admin?billing=canceled`,
    });
    res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("[create-checkout-session] Stripe error:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Could not create a checkout session." });
  }
}
