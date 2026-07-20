/**
 * Single place that reads Stripe-related env vars and resolves them to a
 * typed plan -> Price id lookup. See .env.example for what each var is for.
 */

export type PlanId =
  | 'family_companion_monthly'
  | 'family_companion_annual'
  | 'premium_care_monthly'
  | 'premium_care_annual'
  | 'gift_package_3_months'
  | 'founding_facility_pilot';

const PLAN_ENV_VARS: Record<PlanId, string> = {
  family_companion_monthly: 'STRIPE_PRICE_FAMILY_MONTHLY',
  family_companion_annual: 'STRIPE_PRICE_FAMILY_ANNUAL',
  premium_care_monthly: 'STRIPE_PRICE_PREMIUM_MONTHLY',
  premium_care_annual: 'STRIPE_PRICE_PREMIUM_ANNUAL',
  gift_package_3_months: 'STRIPE_PRICE_GIFT_3MONTH',
  founding_facility_pilot: 'STRIPE_PRICE_FACILITY_PILOT',
};

/**
 * The Stripe Price id configured for a plan. Throws a clear error naming the
 * missing env var if it's unset — mirrors getStripeClient's contract in
 * ./index.ts (no silent fallback), so callers explicitly decide how to
 * degrade (e.g. the checkout route's 503 "billing not configured" path)
 * rather than this module doing it for them.
 */
export function getPlanPriceId(plan: PlanId): string {
  const envVar = PLAN_ENV_VARS[plan];
  const priceId = process.env[envVar];
  if (!priceId) throw new Error(`${envVar} is not set (plan: "${plan}"). See .env.example.`);
  return priceId;
}

/**
 * All 6 plan -> Price id mappings at once. Same per-plan throw-on-missing
 * contract as getPlanPriceId. NOT yet safe to call in alpha — only the two
 * family_companion Price ids are guaranteed configured, so this throws on
 * the first unconfigured plan it hits (premium_care/gift/facility_pilot).
 * Revisit once every plan is either live or intentionally optional; use
 * getPlanPriceId directly until then.
 */
export function getPlanPriceIds(): Record<PlanId, string> {
  const entries = (Object.keys(PLAN_ENV_VARS) as PlanId[]).map((plan) => [plan, getPlanPriceId(plan)] as const);
  return Object.fromEntries(entries) as Record<PlanId, string>;
}

/**
 * Raw (non-throwing) read of the Stripe secret key, so getStripeClient
 * (./index.ts) keeps reading it through this module without changing its
 * existing "undefined -> degrade, don't crash" contract.
 */
export function getStripeSecretKeyRaw(): string | undefined {
  return process.env.STRIPE_SECRET_KEY;
}

// TODO: consume premium_care_monthly/premium_care_annual,
// gift_package_3_months, and founding_facility_pilot Price ids once those
// plans have real checkout flows. Only family_companion_monthly/annual are
// wired up today, via getPriceIdForInterval in ./index.ts (used by
// src/app/api/billing/checkout/route.ts). The other four plans have no
// consuming code yet — reference getPlanPriceId/getPlanPriceIds above when
// building them, rather than reading their env vars directly.
