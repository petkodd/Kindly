import type Stripe from 'stripe';
import { getPlanIntervalPriceId, getStripeSecretKeyRaw } from './config';

export * from './config';

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
  const apiKey = getStripeSecretKeyRaw();
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

export type BillingInterval = 'month' | 'year';

/**
 * The raw Stripe Price id configured for the Family Companion plan's billing
 * interval. Throws if unset — callers decide how to degrade (e.g. the
 * checkout route's existing 503 "billing not configured" path), same
 * contract as getStripeClient. Thin wrapper over getPlanIntervalPriceId
 * (./config) fixed to the 'family_companion' plan family, since that's the
 * only one the checkout route wires up today.
 */
export function getPriceIdForInterval(interval: BillingInterval): string {
  return getPlanIntervalPriceId('family_companion', interval);
}

// Referral-reward-for-annual mechanism (deferred, not implemented here):
// once feature/referral-program merges, an annual subscriber's "one free
// month" should credit 1/12 of the annual price (Option B from the
// annual-billing task doc) rather than a full month's price — chosen over
// extending a subscription schedule's period boundaries for the same
// reliability reason the base referral reward already uses a balance
// credit over subscription mutation. Deliberately not built as code yet:
// nothing in this branch calls it, and unexercised exported utilities are
// worse than a documented follow-up. Implement alongside the actual
// applyReferralReward/applySide wiring in src/lib/billing/referralReward.ts
// (feature/referral-program), using getPriceIdForInterval + a live
// stripe.prices.retrieve for both intervals to size the credit.
