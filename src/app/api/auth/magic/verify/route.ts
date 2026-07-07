import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { magicLinkRepo } from '@/lib/repos/magicLink';
import { signSession, attachSession } from '@/lib/session';
import { NotFoundError } from '@/lib/types';

const invalid = () =>
  NextResponse.json(
    { error: { code: 'not_found', message: 'This link is invalid, expired, or already used.' } },
    { status: 404 },
  );

/**
 * Exchange a magic-link token for a session cookie. The token is single-use
 * (magicLinkRepo.consume marks it used atomically), so a captured email link
 * can't be replayed even if the recipient clicks it twice.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const body = await readJsonBody(req);
    const token = (body.token as string) ?? '';

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
