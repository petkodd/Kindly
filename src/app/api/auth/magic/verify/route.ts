import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse, clientIp } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { magicLinkRepo } from '@/lib/repos/magicLink';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { signSession, attachSession } from '@/lib/session';
import { NotFoundError, RateLimitError } from '@/lib/types';

const invalid = () =>
  NextResponse.json(
    { error: { code: 'not_found', message: 'This link is invalid, expired, or already used.' } },
    { status: 404 },
  );

// Unauthenticated endpoint doing a DB write per call — throttle per IP, same
// rationale as /api/talk/auth (also an unauthenticated token-exchange route).
const VERIFY_LIMIT = 20;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;

/**
 * Exchange a magic-link token for a session cookie. The token is single-use
 * (magicLinkRepo.consume marks it used atomically), so a captured email link
 * can't be replayed even if the recipient clicks it twice.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const rl = await rateLimitRepo.hit(pool, `magicverify:ip:${clientIp(req)}`, {
      limit: VERIFY_LIMIT,
      windowMs: VERIFY_WINDOW_MS,
    });
    if (!rl.allowed) throw new RateLimitError('Too many attempts. Please try again later.');

    const body = await readJsonBody(req);
    const token = typeof body.token === 'string' ? body.token : '';

    let userId: string;
    try {
      userId = await magicLinkRepo.consume(pool, token);
    } catch (err) {
      if (err instanceof NotFoundError) return invalid();
      throw err;
    }

    const info = await userRepo.sessionAuth(pool, userId);
    if (!info || info.deleted_at) return invalid(); // account deleted since the link was sent

    const sessionToken = signSession(userId, { isAdmin: info.is_admin });
    const res = NextResponse.json({ ok: true });
    return attachSession(res, sessionToken);
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
