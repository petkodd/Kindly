/**
 * Pure display-math helpers for the Monthly/Annual billing toggle — no
 * Stripe calls, no DB, safe to use in both server and client components.
 * All amounts are integer cents to avoid float rounding artifacts.
 */

export function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The per-month figure to show next to an annual price, e.g. $566.40/yr -> $47.20/mo. */
export function perMonthEquivalentCents(annualCents: number): number {
  return Math.round(annualCents / 12);
}

/** Whole-percent savings of paying annually vs. 12 months at the monthly rate. */
export function computeAnnualSavingsPercent(monthlyCents: number, annualCents: number): number {
  if (monthlyCents <= 0) return 0;
  return Math.round((1 - annualCents / (monthlyCents * 12)) * 100);
}
