import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { accessTokenRepo } from '@/lib/repos/accessToken';

// Next 15: dynamic route params arrive as a Promise.
type Ctx = { params: Promise<{ id: string }> };

/**
 * Status of the parent's talk link for the buyer's "Parent's talk link"
 * section: whether one is active, and when it was made / expires. The raw
 * token is never retrievable after issue — to show a link again, issue a new one.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    return NextResponse.json(await accessTokenRepo.activeStatus(pool, params.id));
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * Issue a passwordless talk link for the parent. Returns the raw token ONCE.
 * By default this revokes any prior active link (accessTokenRepo.issue's
 * single-active-link rule — a leaked gift link should invalidate old ones).
 * Pass `{ keep_existing: true }` to opt out: self-use profiles mint this
 * token automatically from the buyer's own authenticated browser (not a
 * link handed to a third party), so re-entering /app/talk from a second
 * device shouldn't silently revoke the first device's session.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
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
