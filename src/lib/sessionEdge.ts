import type { SessionClaims } from './session';

/**
 * Edge-runtime twin of verifySession (session.ts) for src/middleware.ts, which
 * cannot use node:crypto. Same token format: `base64url(payload).base64url(
 * HMAC-SHA256(payload, SESSION_SECRET))`, checked with Web Crypto's
 * constant-time HMAC verify, plus the expiry.
 *
 * This only proves the cookie was signed by us and hasn't expired. It cannot
 * see revocation (logout elsewhere, password change) or a deleted account —
 * those need the DB. That is fine for redirects; every API route still calls
 * resolveBuyer/resolveAdmin, which check both.
 */
function b64urlToBytes(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function verifySessionEdge(
  token: string | undefined | null,
  secret: string | undefined = process.env.SESSION_SECRET,
): Promise<SessionClaims | null> {
  if (!token || !secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = b64urlToBytes(token.slice(dot + 1));
  if (!sig) return null;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'verify',
    ]);
    const ok = await crypto.subtle.verify('HMAC', key, sig, enc.encode(body));
    if (!ok) return null;
    const json = b64urlToBytes(body);
    if (!json) return null;
    const claims = JSON.parse(new TextDecoder().decode(json)) as SessionClaims;
    if (!claims.uid || typeof claims.exp !== 'number') return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
