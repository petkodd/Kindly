import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse, clientIp } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { signSession, attachSession } from '@/lib/session';
import { RateLimitError } from '@/lib/types';

const invalid = () =>
  NextResponse.json({ error: { code: 'invalid_credentials', message: 'Invalid email or password.' } }, { status: 401 });

// Per-IP brute-force throttle. Keyed on IP (not email) to avoid letting an
// attacker lock out a victim's account by spamming their address.
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Log in with email + password. Returns 200 + session cookie, or a single 401
 * that does not distinguish "no such email" from "wrong password". Throttled per
 * IP against brute-force; a successful login clears the counter.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const rlKey = `login:ip:${clientIp(req)}`;
    const rl = await rateLimitRepo.hit(pool, rlKey, { limit: LOGIN_LIMIT, windowMs: LOGIN_WINDOW_MS });
    if (!rl.allowed) throw new RateLimitError('Too many login attempts. Please try again later.');

    const body = await readJsonBody(req);
    const user = await userRepo.verifyCredentials(pool, body.email as string, body.password as string);
    if (!user) return invalid();

    await rateLimitRepo.reset(pool, rlKey); // legit login → clear the counter
    const token = signSession(user.id, { isAdmin: user.is_admin });
    const res = NextResponse.json({ user });
    return attachSession(res, token);
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
