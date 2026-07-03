import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { signSession, attachSession } from '@/lib/session';

const invalid = () =>
  NextResponse.json({ error: { code: 'invalid_credentials', message: 'Invalid email or password.' } }, { status: 401 });

/**
 * Log in with email + password. Returns 200 + session cookie, or a single 401
 * that does not distinguish "no such email" from "wrong password".
 *
 * TODO(rate-limit): auth endpoints must be throttled (api_plan_v1.md). A shared
 * limiter (e.g. Redis-backed) belongs here before production.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const body = await readJsonBody(req);
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
