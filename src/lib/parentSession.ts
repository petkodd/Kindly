import type { NextResponse } from 'next/server';

/**
 * Parent talk session cookie. The parent arrives with a raw access token in the
 * URL (?token=); the talk page exchanges it once for this httpOnly cookie and
 * strips the token from the URL, so the raw token no longer lingers in browser
 * history or server access logs.
 *
 * The cookie holds the raw token (never readable by JS — httpOnly), scoped to
 * the /api/talk paths and SameSite=Lax so a cross-site POST can't ride it (CSRF).
 * Every talk request still resolves the token against the DB
 * (accessTokenRepo.resolveParentId), so revocation and expiry take effect
 * immediately regardless of the cookie's own lifetime.
 */
export const PARENT_TOKEN_COOKIE = 'kindly_talk';

// Short-lived: the browser drops it after a couple of hours. The token's own
// expiry/revocation is the real gate, checked per request.
const MAX_AGE_SECONDS = 2 * 60 * 60;

function cookieBase() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/talk',
  };
}

/** Store the parent's access token in the talk cookie. */
export function attachParentToken(res: NextResponse, token: string): NextResponse {
  res.cookies.set(PARENT_TOKEN_COOKIE, token, { ...cookieBase(), maxAge: MAX_AGE_SECONDS });
  return res;
}

/** Clear the talk cookie. */
export function clearParentToken(res: NextResponse): NextResponse {
  res.cookies.set(PARENT_TOKEN_COOKIE, '', { ...cookieBase(), maxAge: 0 });
  return res;
}
