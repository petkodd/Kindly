import * as Sentry from '@sentry/nextjs';
import type { Querier } from '../querier';
import type { Referral } from '../repos/referral';
import { subscriptionRepo } from '../repos/subscription';
import { referralRewardRepo, type ReferralReward, type RewardSide } from '../repos/referralReward';
import { auditRepo } from '../repos/audit';
import { getStripeClient, getAlphaPlanPrice } from './index';

const SIDES: RewardSide[] = ['referrer', 'referred'];

function userIdForSide(referral: Referral, side: RewardSide): string {
  if (side === 'referrer') return referral.referrer_id;
  // Only called after a successful redeem, where redeemed_by is always set.
  if (!referral.redeemed_by) throw new Error(`referral ${referral.id} has no redeemed_by`);
  return referral.redeemed_by;
}

async function applySide(
  q: Querier,
  referral: Referral,
  side: RewardSide,
  amountCents: number,
  currency: string,
  actorId: string | null,
): Promise<void> {
  const claimed = await referralRewardRepo.claimSide(q, referral.id, side);
  if (!claimed) return; // already resolved, or a concurrent caller owns it

  const userId = userIdForSide(referral, side);
  const actor = actorId ? 'manual' : 'system';
  const baseMeta = {
    side,
    referrer_user_id: referral.referrer_id,
    referred_user_id: referral.redeemed_by,
    reward_type: 'stripe_balance_credit',
    amount_cents: amountCents,
    currency,
    actor,
  };

  const sub = await subscriptionRepo.getMostRecentWithStripeCustomerForBuyer(q, userId);
  if (!sub?.stripe_customer_id) {
    // Common right after signup — the referred buyer usually hasn't been
    // through checkout yet, so there's no Stripe customer to credit. This is
    // expected and self-resolving (the retry cron picks it up once they
    // subscribe), so it's recorded for Support but doesn't page anyone.
    await referralRewardRepo.markSideFailed(q, referral.id, side, 'no_stripe_customer');
    await auditRepo.log(q, {
      actorId,
      action: 'referral_reward_apply',
      targetType: 'referral_reward',
      targetId: referral.id,
      meta: { ...baseMeta, status: 'failed', failure_reason: 'no_stripe_customer' },
    });
    return;
  }

  try {
    const stripe = getStripeClient();
    const txn = await stripe.customers.createBalanceTransaction(
      sub.stripe_customer_id,
      {
        amount: -amountCents,
        currency,
        description: `Kindly referral reward — one free month (referral ${referral.id}, ${side})`,
      },
      { idempotencyKey: `referral-reward:${referral.id}:${side}` },
    );
    await referralRewardRepo.markSideApplied(q, referral.id, side, txn.id);
    await auditRepo.log(q, {
      actorId,
      action: 'referral_reward_apply',
      targetType: 'referral_reward',
      targetId: referral.id,
      meta: { ...baseMeta, status: 'applied', stripe_object_id: txn.id },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown_stripe_error';
    await referralRewardRepo.markSideFailed(q, referral.id, side, reason);
    await auditRepo.log(q, {
      actorId,
      action: 'referral_reward_apply',
      targetType: 'referral_reward',
      targetId: referral.id,
      meta: { ...baseMeta, status: 'failed', failure_reason: reason },
    });
    // A genuine Stripe-call failure (auth, network, invalid customer) is the
    // actionable "alert Product/Support" case — unlike no_stripe_customer
    // above, this warrants paging.
    Sentry.captureException(err, { tags: { referral_id: referral.id, side } });
  }
}

/**
 * Apply the referral reward for both sides of an already-redeemed referral:
 * one month's plan price credited to each of the referrer's and referred
 * buyer's Stripe customer balance (see src/lib/billing/index.ts for why
 * balance credit was chosen over subscription extension). Idempotent and
 * safe to call repeatedly — from the redeem route right after a successful
 * redemption, from the admin retry endpoint, or from the retry cron — via
 * the referral_id UNIQUE constraint, the per-side claim CAS, and a Stripe
 * idempotency key on every balance-transaction call.
 *
 * Never throws for expected failure modes (Stripe errors, missing Stripe
 * customer) — those are recorded per-side and one side's failure never
 * blocks the other's success. Returns null only when the plan price itself
 * couldn't be resolved (e.g. STRIPE_PRICE_ID unset/misconfigured), in which
 * case no referral_rewards row is created yet and a later retry starts clean.
 *
 * `actorId`: null for system-triggered calls (redeem route, retry cron);
 * the admin's user id for a manual retry, so the audit trail can tell them apart.
 */
export async function applyReferralReward(
  q: Querier,
  referral: Referral,
  actorId: string | null = null,
): Promise<ReferralReward | null> {
  let amountCents: number;
  let currency: string;
  try {
    ({ amountCents, currency } = await getAlphaPlanPrice());
  } catch (err) {
    Sentry.captureException(err, { tags: { referral_id: referral.id } });
    await auditRepo.log(q, {
      actorId,
      action: 'referral_reward_price_lookup_failed',
      targetType: 'referral',
      targetId: referral.id,
      meta: { error: err instanceof Error ? err.message : 'unknown_error', actor: actorId ? 'manual' : 'system' },
    });
    return null;
  }

  await referralRewardRepo.getOrCreatePending(q, {
    referralId: referral.id,
    referrerUserId: referral.referrer_id,
    referredUserId: referral.redeemed_by,
    amountCents,
    currency,
  });

  for (const side of SIDES) {
    await applySide(q, referral, side, amountCents, currency, actorId);
  }

  return referralRewardRepo.getByReferralId(q, referral.id);
}
