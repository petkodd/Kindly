import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveAdmin, adminForbidden, errorToResponse } from '@/lib/auth';
import { referralRewardRepo, type RewardOverallStatus } from '@/lib/repos/referralReward';
import { auditRepo } from '@/lib/repos/audit';

const VALID_STATUSES = new Set<RewardOverallStatus>(['pending', 'partial', 'applied', 'failed', 'reversed']);

/**
 * Referral reward triage list for Support — current status of every reward
 * without touching Stripe, optionally filtered (?status=failed) to the ones
 * needing attention.
 */
export async function GET(req: NextRequest) {
  const adminId = await resolveAdmin(req);
  if (!adminId) return adminForbidden();
  try {
    const pool = db();
    const statusParam = req.nextUrl.searchParams.get('status');
    const status =
      statusParam && VALID_STATUSES.has(statusParam as RewardOverallStatus)
        ? (statusParam as RewardOverallStatus)
        : undefined;
    const rewards = await referralRewardRepo.listByStatus(pool, status);
    await auditRepo.log(pool, {
      actorId: adminId,
      action: 'view_referral_rewards',
      targetType: 'referral_reward',
      meta: status ? { status } : null,
    });
    return NextResponse.json({ rewards });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
