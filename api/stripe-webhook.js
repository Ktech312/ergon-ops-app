// The first unauthenticated-inbound-webhook endpoint in this codebase (flagged as structurally
// novel in PRODUCT_BILLING_SAAS_DECISIONS.md Q2.3) -- every other api/*.js route requires the
// app's own session auth first via requireAuth.js; this one CANNOT, since Stripe itself is the
// caller. Security instead rests entirely on:
//   1. Stripe signature verification (stripe.webhooks.constructEvent against the RAW request
//      body -- bodyParser is disabled below specifically so the exact bytes Stripe signed are
//      what gets verified, not a re-serialized JSON.parse/stringify round-trip).
//   2. Idempotent, atomic processing via process_stripe_webhook_event() (migration 221) --
//      the idempotency-ledger insert and the actual state update happen in ONE function call,
//      so a webhook that fails partway through never gets falsely marked as processed.
//   3. Never trusting the webhook payload as the sole source of truth for CURRENT state where
//      that matters -- see the "stale/out-of-order webhook" mitigation in
//      PRODUCT_BILLING_TECHNICAL_DESIGN.md §1; this handler reads the subscription's actual
//      current status directly off the event's own subscription object (Stripe already embeds
//      the full, current object in every subscription-related event), not a cached guess.
// Called with the SERVICE ROLE key throughout (never the caller's own token, since there is no
// caller session) -- this is a deliberate, narrow exception to requireAuth.js's usual pattern,
// not a precedent for any other route to follow.

import { getStripeClient } from "./_lib/stripeClient.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// Maps a Stripe subscription's own `status` to this app's workspace_billing.status enum --
// they're deliberately kept aligned 1:1 except Stripe's 'incomplete'/'incomplete_expired' (a
// checkout that was started but never finished -- not yet a real subscription for our purposes,
// treated as trialing/no-op rather than inventing a new status value for it) and 'paused'
// (Stripe's own pause-collection feature, not used by this app's Checkout/Portal flow today --
// mapped to 'past_due' defensively rather than silently dropped, since it means access should
// not be assumed active).
function mapStripeStatus(stripeStatus) {
  switch (stripeStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
      return "unpaid";
    case "canceled":
      return "canceled";
    case "paused":
      return "past_due";
    default:
      return null;
  }
}

async function callRpc(supabaseUrl, serviceRoleKey, fn, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return response;
}

async function findWorkspaceIdForSubscription(supabaseUrl, serviceRoleKey, subscription) {
  // Prefer the subscription's own metadata (stamped at creation time by
  // api/create-checkout-session.js's subscription_data.metadata) -- falls back to the
  // customer's metadata for an older/manually-created subscription that predates this field.
  if (subscription.metadata?.workspace_id) {
    return subscription.metadata.workspace_id;
  }
  const lookupResponse = await fetch(
    `${supabaseUrl}/rest/v1/workspace_billing?stripe_customer_id=eq.${encodeURIComponent(subscription.customer)}&select=workspace_id`,
    { headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` } },
  );
  if (!lookupResponse.ok) {
    return null;
  }
  const rows = await lookupResponse.json();
  return rows[0]?.workspace_id || null;
}

async function findPlanKeyForPriceId(supabaseUrl, serviceRoleKey, priceId) {
  if (!priceId) {
    return null;
  }
  const response = await fetch(
    `${supabaseUrl}/rest/v1/billing_plans?or=(stripe_monthly_price_id.eq.${encodeURIComponent(priceId)},stripe_annual_price_id.eq.${encodeURIComponent(priceId)})&select=plan_key`,
    { headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` } },
  );
  if (!response.ok) {
    return null;
  }
  const rows = await response.json();
  return rows[0]?.plan_key || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripe || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    // Not configured -- 200s so Stripe doesn't retry forever against a deployment that will
    // never be able to process it, but does nothing. Never reveals which piece is missing.
    res.status(200).json({ received: false, reason: "Not configured." });
    return;
  }

  const signature = req.headers["stripe-signature"];
  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    // Deliberately generic -- never echoes back why verification failed.
    console.error("[stripe-webhook] Signature verification failed:", error instanceof Error ? error.message : error);
    res.status(400).json({ error: "Invalid signature." });
    return;
  }

  let workspaceId = null;
  let newStatus = null;
  let stripeCustomerId = null;
  let stripeSubscriptionId = null;
  let currentPeriodEnd = null;
  let planKey = null;

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      workspaceId = session.client_reference_id || session.metadata?.workspace_id || null;
      stripeCustomerId = session.customer || null;
      stripeSubscriptionId = session.subscription || null;
      if (stripeSubscriptionId) {
        // Re-fetch the subscription fresh rather than trusting only the checkout session's own
        // snapshot -- the stale-webhook mitigation from the threat model, applied at the very
        // first event a new subscription ever produces.
        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        newStatus = mapStripeStatus(subscription.status);
        currentPeriodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;
        planKey = await findPlanKeyForPriceId(supabaseUrl, serviceRoleKey, subscription.items?.data?.[0]?.price?.id);
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
      const subscription = event.data.object;
      workspaceId = await findWorkspaceIdForSubscription(supabaseUrl, serviceRoleKey, subscription);
      stripeCustomerId = subscription.customer || null;
      stripeSubscriptionId = subscription.id || null;
      newStatus = mapStripeStatus(subscription.status);
      currentPeriodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;
      planKey = await findPlanKeyForPriceId(supabaseUrl, serviceRoleKey, subscription.items?.data?.[0]?.price?.id);
    } else if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      workspaceId = await findWorkspaceIdForSubscription(supabaseUrl, serviceRoleKey, subscription);
      stripeCustomerId = subscription.customer || null;
      stripeSubscriptionId = subscription.id || null;
      newStatus = "canceled";
    } else {
      // An event type we don't act on (e.g. invoice.* line-item detail) -- still recorded for
      // idempotency/audit via the RPC's own no-workspace branch, so a future handler extension
      // never has to worry about a gap in the event history.
      newStatus = null;
    }

    const rpcResponse = await callRpc(supabaseUrl, serviceRoleKey, "process_stripe_webhook_event", {
      p_stripe_event_id: event.id,
      p_event_type: event.type,
      p_payload: event.data.object,
      p_workspace_id: newStatus ? workspaceId : null,
      p_new_status: newStatus,
      p_stripe_customer_id: stripeCustomerId,
      p_stripe_subscription_id: stripeSubscriptionId,
      p_current_period_end: currentPeriodEnd,
      p_plan_key: planKey,
    });

    if (!rpcResponse.ok) {
      const bodyText = await rpcResponse.text().catch(() => "");
      console.error(`[stripe-webhook] process_stripe_webhook_event failed (${rpcResponse.status}): ${bodyText}`);
      // 500 so Stripe retries -- the idempotency insert inside the RPC only commits together
      // with a successful state update, so a retry after this failure is safe, not a double-
      // apply risk.
      res.status(500).json({ error: "Could not process event." });
      return;
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("[stripe-webhook] Unhandled processing error:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Could not process event." });
  }
}
