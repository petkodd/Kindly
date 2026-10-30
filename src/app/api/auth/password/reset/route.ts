import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse, clientIp, rejectCrossOrigin } from '@/lib/auth';
import { userRepo, MIN_PASSWORD_LENGTH } from '@/lib/repos/user';
import { magicLinkRepo } from '@/lib/repos/magicLink';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { auditRepo } from '@/lib/repos/audit';
import { NotFoundError, ValidationError } from '@/lib/types';
import { clearSession } from '@/lib/session';

/**
 * Set a new password from an emailed reset link — no current password
 * needed. The link is single-use and can't be a sign-in link. On success every
 * existing session (every device) is revoked and the caller is NOT signed in:
 * they sign in again with the new password. (Signing in here would race the
 * revocation watermark set by the database clock.)
 */
export async function POST(req: NextRequest) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  try {
    const pool = db();
    await rateLimitRepo.enforce(pool, `reset:ip:${clientIp(req)}`, { limit: 20, windowMs: 15 * 60 * 1000 });
    const body = await readJsonBody(req);
    const password = typeof body.password === 'string' ? body.password : '';
    // Check the new password BEFORE spending the single-use link on it.
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(`Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    let userId: string;
    try {
      userId = await magicLinkRepo.consume(pool, typeof body.token === 'string' ? body.token : '', 'reset');
    } catch (err) {
      if (err instanceof NotFoundError) {
        return NextResponse.json(
          { error: { code: 'not_found', message: 'This reset link is invalid, expired, or already used. Please request a new one.' } },
          { status: 404 },
        );
      }
      throw err;
    }
    await userRepo.resetPassword(pool, userId, password);
    await auditRepo.log(pool, { actorId: userId, action: 'password_reset', targetType: 'user', targetId: userId });
    return clearSession(NextResponse.json({ ok: true }));
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
