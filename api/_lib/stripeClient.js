// Shared Stripe SDK initialization. STRIPE_SECRET_KEY is server-only (never a VITE_* var,
// matching the existing GMAIL_APP_PASSWORD/RESEND_API_KEY pattern in mailer.js) -- test-mode
// keys (sk_test_...) in every non-production Vercel environment, live keys only in production,
// per PRODUCT_BILLING_TECHNICAL_DESIGN.md §4. Returns null (never throws) when unconfigured,
// same honest-fallback posture as every other optional integration in this app -- a route that
// needs Stripe checks for null and responds accordingly rather than crashing.
import Stripe from "stripe";

let stripeClient = null;
let stripeClientKey = null;

export function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return null;
  }
  // Re-instantiate only if the key actually changed (defensive -- env vars don't change within
  // one running instance, but this avoids ever holding a stale client across a hypothetical
  // future key-rotation without a redeploy).
  if (!stripeClient || stripeClientKey !== key) {
    stripeClient = new Stripe(key, { apiVersion: "2025-01-27.acacia" });
    stripeClientKey = key;
  }
  return stripeClient;
}
