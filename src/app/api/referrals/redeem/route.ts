import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBuyerId, readJsonBody, errorToResponse } from '@/lib/auth';
import { referralRepo } from '@/lib/repos/referral';
import { ValidationError } from '@/lib/types';

/**
 * Redeem a referral code. The redeemer is the signed-in buyer (redemption
 * happens right after signup, when a session already exists). Fraud-guarded by
 * household in the repo. `household_hash` is derived client/edge-side (e.g. from
 * address/payment) and passed in.
 */
export async function POST(req: NextRequest) {
  const buyerId = getBuyerId(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    const body = await readJsonBody(req);
    const code = body.code as string;
    if (!code) throw new ValidationError('code is required');
    await referralRepo.redeem(pool, code, {
      redeemerId: buyerId,
      householdHash: (body.household_hash as string) ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
