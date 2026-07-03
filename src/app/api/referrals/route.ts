import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBuyerId, errorToResponse } from '@/lib/auth';
import { referralRepo } from '@/lib/repos/referral';

/** Generate a unique referral code for the signed-in buyer. */
export async function POST(req: NextRequest) {
  const buyerId = getBuyerId(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    const referral = await referralRepo.generate(pool, buyerId);
    return NextResponse.json({ code: referral.code }, { status: 201 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
