import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { referralRepo } from '@/lib/repos/referral';

/**
 * The signed-in buyer's active (unredeemed) referral code, or null, plus the
 * status of every redemption of their codes ('pending' until the new family's
 * first paid invoice, then 'credited'). No redeemer identity is returned.
 * `used_code` says whether this buyer has redeemed someone else's code.
 */
export async function GET(req: NextRequest) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    const referral = await referralRepo.getActiveForBuyer(pool, buyerId);
    const redemptions = await referralRepo.listRedemptionsForReferrer(pool, buyerId);
    const usedCode = (await referralRepo.getRedeemedBy(pool, buyerId)) !== null;
    return NextResponse.json({ code: referral?.code ?? null, redemptions, used_code: usedCode });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * The buyer's referral code: one active code per user, so this returns the
 * existing unredeemed code (200) and only generates a new one (201) when
 * there is none (never generated, or the last one was used).
 */
export async function POST(req: NextRequest) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await rateLimitRepo.enforce(pool, `referral:create:${buyerId}`, { limit: 20, windowMs: 60 * 60 * 1000 });
    const { referral, created } = await referralRepo.getOrCreateActive(pool, buyerId);
    return NextResponse.json({ code: referral.code }, { status: created ? 201 : 200 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
