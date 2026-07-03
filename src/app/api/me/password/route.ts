import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, readJsonBody, errorToResponse } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { signSession, attachSession } from '@/lib/session';
import { ValidationError } from '@/lib/types';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });

/** Change the buyer's password (requires the current password). */
export async function POST(req: NextRequest) {
  const userId = await resolveBuyer(req);
  if (!userId) return unauthorized();
  try {
    const body = await readJsonBody(req);
    const current = body.current_password as string;
    const next = body.new_password as string;
    if (!current || !next) throw new ValidationError('current_password and new_password are required');
    const pool = db();
    await userRepo.changePassword(pool, userId, current, next);
    // changePassword revoked ALL sessions (including this one). Re-issue a fresh
    // session so the current device stays signed in; other devices are logged out.
    const account = await userRepo.getAccount(pool, userId);
    return attachSession(
      new NextResponse(null, { status: 204 }),
      signSession(account.id, { isAdmin: account.is_admin }),
    );
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
