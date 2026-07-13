import type Stripe from 'stripe';

let cached: Stripe | undefined;

/**
 * Resolve the Stripe client. Unlike the AI/email/speech provider factories,
 * there is no deterministic fake here — a meaningful fake would need to fake
 * both Checkout Sessions and webhook signature verification for little test
 * value. Callers (the checkout/webhook routes) are responsible for degrading
 * gracefully when STRIPE_SECRET_KEY is unset; this throws so that never
 * happens silently. Lazy import keeps the SDK out of the keyless path,
 * mirroring src/lib/ai/index.ts and src/lib/email/index.ts.
 */
export function getStripeClient(): Stripe {
  if (cached) return cached;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY is not set. See .env.example.');
  }
  const StripeCtor = require('stripe') as typeof Stripe;
  cached = new StripeCtor(apiKey);
  return cached;
}

/** Test seam: reset the memoized client (e.g. after changing env in a test). */
export function resetStripeClient(): void {
  cached = undefined;
}
