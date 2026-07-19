import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { referralRepo } from '../src/lib/repos/referral';
import { referralRewardRepo } from '../src/lib/repos/referralReward';

const stripeMock = {
  createBalanceTransaction: vi.fn(),
  getAlphaPlanPrice: vi.fn(),
};
vi.mock('@/lib/billing', () => ({
  getStripeClient: () => ({
    customers: { createBalanceTransaction: stripeMock.createBalanceTransaction },
  }),
  getAlphaPlanPrice: () => stripeMock.getAlphaPlanPrice(),
}));

// Imported after the mock so applyReferralReward (used internally) picks it up.
import { retryReferralRewards } from '../src/lib/jobs/retryReferralRewards';

let q: Querier;

async function makeUser(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function giveStripeCustomer(buyerId: string, customerId: string): Promise<void> {
  await q.query(
    `INSERT INTO subscriptions (buyer_id, plan, status, stripe_customer_id, current_period_end)
     VALUES ($1, 'family', 'trialing', $2, now() + interval '7 days')`,
    [buyerId, customerId],
  );
}

beforeEach(() => {
  q = makeTestDb();
  stripeMock.createBalanceTransaction.mockReset().mockResolvedValue({ id: 'cbtxn_retry' });
  stripeMock.getAlphaPlanPrice.mockReset().mockResolvedValue({ amountCents: 5900, currency: 'usd' });
});

describe('retryReferralRewards', () => {
  it('is a no-op on a clean database', async () => {
    expect(await retryReferralRewards(q)).toEqual({ attempted: 0, applied: 0 });
  });

  it('re-applies a reward whose referred side had no Stripe customer at redemption time, now that they have one', async () => {
    const referrer = await makeUser('retry-referrer@example.com');
    const redeemer = await makeUser('retry-redeemer@example.com');
    const code = await referralRepo.generate(q, referrer);
    const referral = await referralRepo.redeem(q, code.code, { redeemerId: redeemer, householdHash: 'hh-retry' });
    await giveStripeCustomer(referrer, 'cus_referrer_retry');
    // No Stripe customer for the redeemer yet — mirrors the real signup-time gap.
    await referralRewardRepo.getOrCreatePending(q, {
      referralId: referral.id,
      referrerUserId: referrer,
      referredUserId: redeemer,
      amountCents: 5900,
      currency: 'usd',
    });

    const first = await retryReferralRewards(q);
    expect(first.attempted).toBe(1);
    // referrer side resolves this pass, but overall isn't 'applied' until both sides are.
    expect(first.applied).toBe(0);

    let reward = await referralRewardRepo.getByReferralId(q, referral.id);
    expect(reward?.referrer_status).toBe('applied');
    expect(reward?.referred_status).toBe('failed');

    // The redeemer subsequently subscribes.
    await giveStripeCustomer(redeemer, 'cus_redeemer_retry');
    const second = await retryReferralRewards(q);
    expect(second.attempted).toBe(1);
    expect(second.applied).toBe(1);

    reward = await referralRewardRepo.getByReferralId(q, referral.id);
    expect(reward?.status).toBe('applied');
  });

  it('does not re-attempt a fully-applied reward', async () => {
    const referrer = await makeUser('retry-done-referrer@example.com');
    const redeemer = await makeUser('retry-done-redeemer@example.com');
    const code = await referralRepo.generate(q, referrer);
    const referral = await referralRepo.redeem(q, code.code, { redeemerId: redeemer, householdHash: 'hh-done' });
    await giveStripeCustomer(referrer, 'cus_a');
    await giveStripeCustomer(redeemer, 'cus_b');
    await referralRewardRepo.getOrCreatePending(q, {
      referralId: referral.id,
      referrerUserId: referrer,
      referredUserId: redeemer,
      amountCents: 5900,
      currency: 'usd',
    });
    await referralRewardRepo.markSideApplied(q, referral.id, 'referrer', 'cbtxn_x');
    await referralRewardRepo.markSideApplied(q, referral.id, 'referred', 'cbtxn_y');

    const result = await retryReferralRewards(q);
    expect(result).toEqual({ attempted: 0, applied: 0 });
    expect(stripeMock.createBalanceTransaction).not.toHaveBeenCalled();
  });
});
