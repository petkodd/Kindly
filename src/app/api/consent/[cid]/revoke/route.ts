import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { consentRepo } from '@/lib/repos/consent';

// Next 15: dynamic route params arrive as a Promise.
type Ctx = { params: Promise<{ cid: string }> };

/**
 * Revoke a consent (e.g. remove a summary recipient). Buyer-scoped: the consent
 * must belong to a parent the caller owns, else 404 (isolation). Once revoked a
 * recipient stops receiving summaries — listAcceptedRecipients excludes it.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    await consentRepo.revokeForBuyer(db(), params.cid, buyerId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
