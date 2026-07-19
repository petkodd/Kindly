import type { Querier } from '../querier';
import { referralRepo } from '../repos/referral';
import { referralRewardRepo } from '../repos/referralReward';
import { applyReferralReward } from '../billing/referralReward';

export interface RetryReferralRewardsResult {
  attempted: number;
  applied: number;
}

/**
 * Daily retry for referral rewards that haven't fully applied. The common
 * case this exists for: redemption happens right after signup, when the
 * referred buyer usually has no Stripe customer yet (see
 * src/lib/billing/referralReward.ts, 'no_stripe_customer') — this job
 * re-attempts once they've since gone through checkout, without relying on
 * Support noticing via the admin retry tool. Safe to run repeatedly:
 * applyReferralReward is fully idempotent per side (claim CAS + Stripe
 * idempotency key), so a reward that's already applied is left untouched.
 */
export async function retryReferralRewards(q: Querier): Promise<RetryReferralRewardsResult> {
  const [pending, partial, failed] = await Promise.all([
    referralRewardRepo.listByStatus(q, 'pending'),
    referralRewardRepo.listByStatus(q, 'partial'),
    referralRewardRepo.listByStatus(q, 'failed'),
  ]);
  const rewards = [...pending, ...partial, ...failed];

  let applied = 0;
  for (const reward of rewards) {
    const referral = await referralRepo.getById(q, reward.referral_id);
    if (!referral) continue; // referral row is gone (e.g. purged) — nothing to retry
    const result = await applyReferralReward(q, referral);
    if (result?.status === 'applied') applied += 1;
  }
  return { attempted: rewards.length, applied };
}
