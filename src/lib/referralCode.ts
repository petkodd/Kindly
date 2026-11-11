/**
 * Referral code capture (chat 11). Edge-safe (no node imports): used by the
 * middleware, the signup route and client components.
 *
 * A `?ref=CODE` on any page is stored in the REF_COOKIE cookie for 30 days, so
 * a family who follows a friend's link and signs up later still gets the code
 * prefilled. The cookie is readable by page scripts on purpose (to prefill the
 * field); it holds only the shareable code, nothing about the visitor.
 */
export const REF_COOKIE = 'dearly_ref';
export const REF_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

// Same alphabet and length as src/lib/repos/referral.ts generates.
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;

/** Upper-cased, trimmed code if it has the shape of a real code, else null. */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** Read the captured code from `document.cookie` (client components only). */
export function readReferralCookie(cookieString: string): string | null {
  for (const part of cookieString.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === REF_COOKIE) return normalizeReferralCode(decodeURIComponent(v.join('=')));
  }
  return null;
}
