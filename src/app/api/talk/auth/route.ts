import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse, clientIp } from '@/lib/auth';
import { accessTokenRepo } from '@/lib/repos/accessToken';
import { attachParentToken } from '@/lib/parentSession';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { NotFoundError, RateLimitError } from '@/lib/types';
import { parentRepo } from '@/lib/repos/parent';
import { talkContextFor, type TalkContextPayload } from '@/lib/talk/serverContext';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Invalid or expired link.' } }, { status: 401 });

// Unauthenticated endpoint doing a DB lookup per call — throttle per IP. Tokens
// are 256-bit random so guessing is infeasible; this just blunts hammering.
const EXCHANGE_LIMIT = 20;
const EXCHANGE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Exchange a raw parent access token (from the talk link's ?token=) for an
 * httpOnly cookie, so the raw token can be dropped from the URL. Validates the
 * token first — an unknown/expired/revoked token gets a 401 and no cookie.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const rl = await rateLimitRepo.hit(pool, `talkauth:ip:${clientIp(req)}`, {
      limit: EXCHANGE_LIMIT,
      windowMs: EXCHANGE_WINDOW_MS,
    });
    if (!rl.allowed) throw new RateLimitError('Too many attempts. Please try again later.');

    const body = await readJsonBody(req);
    const token = (body.token as string) ?? '';
    let parentId: string;
    try {
      parentId = await accessTokenRepo.resolveParentId(pool, token);
    } catch (err) {
      if (err instanceof NotFoundError) return unauthorized();
      throw err;
    }
    // Who to name in "Please ask Sarah to send you a new link." Only after the
    // token is proven valid; best-effort, never blocks the exchange.
    let context: TalkContextPayload = { family_first_name: null, link_owner: 'family' };
    try {
      context = await talkContextFor(pool, await parentRepo.getById(pool, parentId));
    } catch (err) {
      console.error('talk context lookup failed', err);
    }
    return attachParentToken(NextResponse.json({ ok: true, ...context }), token);
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
