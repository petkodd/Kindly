/**
 * Single place that reads and validates the Founding Family Beta env vars —
 * mirrors src/lib/billing/config.ts's "one place, no silent fallback for the
 * flag itself" contract. FOUNDING_FAMILY_BETA_ENABLED gates the beta
 * activation endpoint (src/app/api/billing/beta/activate/route.ts); it is
 * deliberately NOT a general-purpose bypass — it only ever affects requests
 * carrying a real, redeemed beta_invites token, never billing at large.
 */

/** Absent or anything other than the literal string "true" -> disabled. Fails closed. */
export function isFoundingBetaEnabled(): boolean {
  return process.env.FOUNDING_FAMILY_BETA_ENABLED === 'true';
}

const DEFAULT_BETA_DAYS = 14;
// A "beta" with no real end date isn't a beta — bound it well short of a year
// so a typo'd env var (e.g. an extra zero) can't silently grant ~perpetual
// free access.
const MAX_BETA_DAYS = 365;

/**
 * FOUNDING_FAMILY_BETA_DAYS, validated as a bounded positive integer.
 * Unset, non-numeric, non-integer, zero/negative, or over MAX_BETA_DAYS all
 * fall back to the 14-day default rather than throwing — the duration isn't
 * itself a security gate (isFoundingBetaEnabled is), so degrading to a safe
 * default keeps a misconfigured value from taking the whole feature down.
 */
export function getFoundingBetaDurationDays(): number {
  const raw = process.env.FOUNDING_FAMILY_BETA_DAYS;
  if (!raw) return DEFAULT_BETA_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_BETA_DAYS) return DEFAULT_BETA_DAYS;
  return n;
}
