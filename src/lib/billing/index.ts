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

export type BillingInterval = 'month' | 'year';

function priceEnvVar(interval: BillingInterval): string {
  return interval === 'year' ? 'STRIPE_PRICE_ID_ANNUAL' : 'STRIPE_PRICE_ID';
}

/**
 * The raw Stripe Price id configured for a billing interval. Throws if
 * unset — callers decide how to degrade (e.g. the checkout route's existing
 * 503 "billing not configured" path), same contract as getStripeClient.
 */
export function getPriceIdForInterval(interval: BillingInterval): string {
  const envVar = priceEnvVar(interval);
  const priceId = process.env[envVar];
  if (!priceId) throw new Error(`${envVar} is not set. See .env.example.`);
  return priceId;
}

const priceCache = new Map<BillingInterval, { amountCents: number; currency: string }>();

/**
 * A plan's price for a given interval, read live from Stripe rather than
 * hardcoded — mirrors the marketing-copy-drift concern already called out
 * above src/lib/content.ts's PRICING export. Memoized per interval.
 */
export async function getPlanPrice(interval: BillingInterval): Promise<{ amountCents: number; currency: string }> {
  const existing = priceCache.get(interval);
  if (existing) return existing;
  const priceId = getPriceIdForInterval(interval);
  const price = await getStripeClient().prices.retrieve(priceId);
  if (price.unit_amount == null) {
    throw new Error(`Stripe price ${priceId} has no fixed unit_amount.`);
  }
  const result = { amountCents: price.unit_amount, currency: price.currency };
  priceCache.set(interval, result);
  return result;
}

/** Test seam: reset the memoized prices (e.g. after changing a mocked Stripe response). */
export function resetPriceCache(): void {
  priceCache.clear();
}

/**
 * Referral-reward-for-annual mechanism (Option B from the annual-billing
 * task doc): a monthly subscriber's "one free month" credits one month's
 * price (unchanged); an annual subscriber's equivalent credits 1/12 of the
 * annual price. Chosen over extending a subscription schedule's period
 * boundaries for the same reliability reason the base referral reward
 * already uses a balance credit over subscription mutation — it keeps
 * working across cancellations/plan switches without new edge cases.
 *
 * NOT YET WIRED into applyReferralReward/applySide — those live in
 * src/lib/billing/referralReward.ts on feature/referral-program, not yet
 * merged into this branch's base. Once both branches share a common base,
 * that file's per-side amount resolution becomes:
 *   const { amountCents: monthlyCents } = await getPlanPrice('month');
 *   const { amountCents: annualCents } = await getPlanPrice('year');
 *   const amountCents = computeReferralCreditCents(sub.billing_interval, monthlyCents, annualCents);
 * (replacing its current single `getAlphaPlanPrice()` call, which itself
 * should become a one-line delegate to `getPlanPrice('month')`.)
 */
export function computeReferralCreditCents(
  interval: BillingInterval | null,
  monthlyCents: number,
  annualCents: number,
): number {
  return interval === 'year' ? Math.round(annualCents / 12) : monthlyCents;
}
