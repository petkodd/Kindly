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

let cachedPrice: { amountCents: number; currency: string } | undefined;

/**
 * The alpha plan's price, read live from Stripe rather than hardcoded —
 * mirrors the marketing-copy-drift concern already called out above
 * src/lib/content.ts's PRICING export. Used to size the referral-reward
 * balance credit (one month's plan price). Memoized: the Price rarely
 * changes and this is called on every reward application.
 */
export async function getAlphaPlanPrice(): Promise<{ amountCents: number; currency: string }> {
  if (cachedPrice) return cachedPrice;
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error('STRIPE_PRICE_ID is not set. See .env.example.');
  }
  const price = await getStripeClient().prices.retrieve(priceId);
  if (price.unit_amount == null) {
    throw new Error(`Stripe price ${priceId} has no fixed unit_amount.`);
  }
  cachedPrice = { amountCents: price.unit_amount, currency: price.currency };
  return cachedPrice;
}

/** Test seam: reset the memoized price (e.g. after changing the mocked Stripe response). */
export function resetPriceCache(): void {
  cachedPrice = undefined;
}
