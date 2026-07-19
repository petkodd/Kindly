import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveAdmin, adminForbidden, readJsonBody, errorToResponse } from '@/lib/auth';
import { subscriptionRepo } from '@/lib/repos/subscription';
import { referralRewardRepo, type RewardSide } from '@/lib/repos/referralReward';
import { getStripeClient } from '@/lib/billing';
import { auditRepo } from '@/lib/repos/audit';
import { NotFoundError, PreconditionError, ValidationError } from '@/lib/types';

type Ctx = { params: { referralId: string } };

/**
 * Claw back a side's credit for a billing dispute: creates an offsetting
 * (positive) balance transaction on the same Stripe customer the original
 * credit went to. Stripe balance transactions have no delete/void — this is
 * the documented reversal pattern. Only valid while that side is currently
 * 'applied'; reversing a side that never succeeded or was already reversed
 * 409s instead of silently doing nothing.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const adminId = await resolveAdmin(req);
  if (!adminId) return adminForbidden();
  try {
    const pool = db();
    const body = await readJsonBody(req);
    const side = body.side as RewardSide;
    if (side !== 'referrer' && side !== 'referred') {
      throw new ValidationError("side must be 'referrer' or 'referred'");
    }

    const reward = await referralRewardRepo.getByReferralId(pool, params.referralId);
    if (!reward) throw new NotFoundError('Referral reward not found');

    const sideStatus = side === 'referrer' ? reward.referrer_status : reward.referred_status;
    if (sideStatus !== 'applied') {
      throw new PreconditionError(`Cannot reverse a ${side} reward in status '${sideStatus}' (must be 'applied').`);
    }

    const userId = side === 'referrer' ? reward.referrer_user_id : reward.referred_user_id;
    if (!userId) throw new PreconditionError('The user for this side no longer exists (account purged).');

    const sub = await subscriptionRepo.getMostRecentWithStripeCustomerForBuyer(pool, userId);
    if (!sub?.stripe_customer_id) {
      throw new PreconditionError('No Stripe customer found to reverse the credit on.');
    }

    const stripe = getStripeClient();
    const txn = await stripe.customers.createBalanceTransaction(
      sub.stripe_customer_id,
      {
        amount: reward.amount_cents,
        currency: reward.currency,
        description: `Kindly referral reward reversal (referral ${params.referralId}, ${side})`,
      },
      { idempotencyKey: `referral-reward-reverse:${params.referralId}:${side}` },
    );

    const updated = await referralRewardRepo.markSideReversed(pool, params.referralId, side, txn.id);
    await auditRepo.log(pool, {
      actorId: adminId,
      action: 'referral_reward_reverse',
      targetType: 'referral_reward',
      targetId: params.referralId,
      meta: { side, stripe_object_id: txn.id, amount_cents: reward.amount_cents, currency: reward.currency, actor: 'manual' },
    });

    return NextResponse.json({ reward: updated });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
