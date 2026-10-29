import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse, clientIp, rejectCrossOrigin } from '@/lib/auth';
import { createHash } from 'node:crypto';
import { userRepo } from '@/lib/repos/user';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { signSession, attachSession } from '@/lib/session';
import { RateLimitError } from '@/lib/types';

const invalid = () =>
  NextResponse.json({ error: { code: 'invalid_credentials', message: 'Invalid email or password.' } }, { status: 401 });

// Brute-force throttles, per IP AND per email, never reset by a success: a
// success-reset let an attacker interleave one real login per guess batch and
// guess forever. Per email stops a botnet spreading guesses over many IPs;
// per IP stops one machine spraying many emails. The per-email limit can let
// someone slow a victim's logins for 15 minutes; magic-link sign-in and
// password reset still work, so that is an acceptable trade-off.
const LOGIN_IP_LIMIT = 20;
const LOGIN_EMAIL_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** Rate-limit key for an email without storing the address itself. */
function emailKey(email: unknown): string {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

/**
 * Log in with email + password. Returns 200 + session cookie, or a single 401
 * that does not distinguish "no such email" from "wrong password" (and takes
 * the same time either way). Throttled per IP and per email.
 */
export async function POST(req: NextRequest) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  try {
    const pool = db();
    const body = await readJsonBody(req);
    const [byIp, byEmail] = await Promise.all([
      rateLimitRepo.hit(pool, `login:ip:${clientIp(req)}`, { limit: LOGIN_IP_LIMIT, windowMs: LOGIN_WINDOW_MS }),
      rateLimitRepo.hit(pool, `login:email:${emailKey(body.email)}`, { limit: LOGIN_EMAIL_LIMIT, windowMs: LOGIN_WINDOW_MS }),
    ]);
    if (!byIp.allowed || !byEmail.allowed) {
      throw new RateLimitError('Too many sign-in attempts. Please wait 15 minutes, or use “Forgot password?”.');
    }

    const user = await userRepo.verifyCredentials(pool, body.email as string, body.password as string);
    if (!user) return invalid();

    const token = signSession(user.id, { isAdmin: user.is_admin });
    const res = NextResponse.json({ user });
    return attachSession(res, token);
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
