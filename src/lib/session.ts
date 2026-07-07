import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';

/**
 * Stateless signed session tokens. The token is `base64url(payload).base64url(
 * HMAC-SHA256(payload, SESSION_SECRET))`; the payload carries the user id, an
 * `adm` flag, and an expiry. Verification is a signature + expiry check with no
 * DB round-trip, so the buyer/admin auth helpers stay synchronous.
 *
 * Trade-off: stateless means logout clears the cookie but a leaked token stays
 * valid until it expires — hence the short default TTL. A server-side denylist
 * can be layered later if per-session revocation is needed.
 */

export const SESSION_COOKIE = 'kindly_session';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface SessionClaims {
  uid: string;
  adm: boolean;
  iat: number; // issued-at, unix seconds — checked against users.sessions_valid_from
  exp: number; // unix seconds
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set. See .env.example.');
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(body: string): string {
  return b64url(createHmac('sha256', secret()).update(body).digest());
}

/** Issue a signed session token for a user. */
export function signSession(
  uid: string,
  opts: { isAdmin?: boolean; ttlSeconds?: number } = {},
): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const claims: SessionClaims = { uid, adm: opts.isAdmin ?? false, iat, exp };
  const body = b64url(Buffer.from(JSON.stringify(claims)));
  return `${body}.${sign(body)}`;
}

/** Verify a token: valid signature + not expired. Returns claims or null. */
export function verifySession(token: string | undefined | null): SessionClaims | null {
  if (!token) return null;
  // A misconfigured deploy (no secret) degrades to "everyone is logged out"
  // rather than throwing a 500 on every request that carries a stale cookie.
  if (!process.env.SESSION_SECRET) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionClaims;
    if (!claims.uid || typeof claims.exp !== 'number') return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

function cookieBase() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

/** Attach a session cookie to a response. */
export function attachSession(res: NextResponse, token: string): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, { ...cookieBase(), maxAge: DEFAULT_TTL_SECONDS });
  return res;
}

/** Clear the session cookie (logout). */
export function clearSession(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, '', { ...cookieBase(), maxAge: 0 });
  return res;
}
