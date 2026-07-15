import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { accessTokenRepo } from '@/lib/repos/accessToken';

type Ctx = { params: { id: string } };

/**
 * Issue a passwordless talk link for the parent. Returns the raw token ONCE.
 * By default this revokes any prior active link (accessTokenRepo.issue's
 * single-active-link rule — a leaked gift link should invalidate old ones).
 * Pass `{ keep_existing: true }` to opt out: self-use profiles mint this
 * token automatically from the buyer's own authenticated browser (not a
 * link handed to a third party), so re-entering /app/talk from a second
 * device shouldn't silently revoke the first device's session.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  let keepExisting = false;
  try {
    const body = await req.json();
    keepExisting = body?.keep_existing === true;
  } catch {
    // No body sent — existing callers (the gift-link flow) don't send one; defaults to false.
  }
  try {
    const pool = db();
    const parent = await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    // keep_existing only applies to self profiles — a gift parent's "reissue
    // to invalidate a leaked link" recovery path must always revoke the prior
    // token, regardless of what the client sends.
    const { token, id } = await accessTokenRepo.issue(pool, params.id, {
      keepExisting: keepExisting && parent.relationship === 'self',
    });
    return NextResponse.json({ token, id }, { status: 201 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
