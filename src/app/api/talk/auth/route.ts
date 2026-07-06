import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse } from '@/lib/auth';
import { accessTokenRepo } from '@/lib/repos/accessToken';
import { attachParentToken } from '@/lib/parentSession';
import { NotFoundError } from '@/lib/types';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Invalid or expired link.' } }, { status: 401 });

/**
 * Exchange a raw parent access token (from the talk link's ?token=) for an
 * httpOnly cookie, so the raw token can be dropped from the URL. Validates the
 * token first — an unknown/expired/revoked token gets a 401 and no cookie.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const body = await readJsonBody(req);
    const token = (body.token as string) ?? '';
    try {
      await accessTokenRepo.resolveParentId(pool, token);
    } catch (err) {
      if (err instanceof NotFoundError) return unauthorized();
      throw err;
    }
    return attachParentToken(NextResponse.json({ ok: true }), token);
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
