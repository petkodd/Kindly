import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveAdmin, adminForbidden, errorToResponse } from '@/lib/auth';
import { referralRepo } from '@/lib/repos/referral';
import { applyReferralReward } from '@/lib/billing/referralReward';
import { auditRepo } from '@/lib/repos/audit';
import { NotFoundError } from '@/lib/types';

type Ctx = { params: { referralId: string } };

/**
 * Re-trigger reward application for a referral. Safe to call any number of
 * times: applyReferralReward only acts on sides that are still pending (or a
 * stale interrupted claim), and every Stripe call carries an idempotency key
 * — an already-applied side is untouched.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const adminId = await resolveAdmin(req);
  if (!adminId) return adminForbidden();
  try {
    const pool = db();
    const referral = await referralRepo.getById(pool, params.referralId);
    if (!referral) throw new NotFoundError('Referral not found');

    const reward = await applyReferralReward(pool, referral, adminId);
    await auditRepo.log(pool, {
      actorId: adminId,
      action: 'referral_reward_retry',
      targetType: 'referral_reward',
      targetId: params.referralId,
      meta: { status: reward?.status ?? 'price_lookup_failed' },
    });
    return NextResponse.json({ reward });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
