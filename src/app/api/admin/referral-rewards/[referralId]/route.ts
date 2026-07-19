import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveAdmin, adminForbidden, errorToResponse } from '@/lib/auth';
import { referralRewardRepo } from '@/lib/repos/referralReward';
import { auditRepo } from '@/lib/repos/audit';
import { NotFoundError } from '@/lib/types';

type Ctx = { params: { referralId: string } };

/** A single referral's reward status/detail, for a Support lookup. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const adminId = await resolveAdmin(req);
  if (!adminId) return adminForbidden();
  try {
    const pool = db();
    const reward = await referralRewardRepo.getByReferralId(pool, params.referralId);
    if (!reward) throw new NotFoundError('Referral reward not found');
    await auditRepo.log(pool, {
      actorId: adminId,
      action: 'view_referral_reward',
      targetType: 'referral_reward',
      targetId: params.referralId,
    });
    return NextResponse.json({ reward });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
