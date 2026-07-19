import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { referralRepo, type Referral } from '../../src/lib/repos/referral';
import { referralRewardRepo } from '../../src/lib/repos/referralReward';
import { userRepo } from '../../src/lib/repos/user';
import { makeBuyer, authedReq } from './helpers';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Minimal stand-ins for the Stripe SDK surface this feature touches, plus
// getAlphaPlanPrice (mocked directly rather than via prices.retrieve — its
// own implementation is simple enough to trust at the unit level). Built via
// vi.hoisted since vi.mock factories are hoisted above top-level const
// declarations and would otherwise reference these before initialization.
const { stripeMock, sentryMock } = vi.hoisted(() => ({
  stripeMock: { createBalanceTransaction: vi.fn(), getAlphaPlanPrice: vi.fn() },
  sentryMock: { captureException: vi.fn() },
}));
vi.mock('@/lib/billing', () => ({
  getStripeClient: () => ({
    customers: { createBalanceTransaction: stripeMock.createBalanceTransaction },
  }),
  getAlphaPlanPrice: () => stripeMock.getAlphaPlanPrice(),
}));
vi.mock('@sentry/nextjs', () => sentryMock);

// Imported AFTER the mocks so they pick up the mocked db()/billing()/Sentry.
import { applyReferralReward } from '../../src/lib/billing/referralReward';
import { GET as rewardsListGET } from '../../src/app/api/admin/referral-rewards/route';
import { GET as rewardGET } from '../../src/app/api/admin/referral-rewards/[referralId]/route';
import { POST as retryPOST } from '../../src/app/api/admin/referral-rewards/[referralId]/retry/route';
import { POST as reversePOST } from '../../src/app/api/admin/referral-rewards/[referralId]/reverse/route';

async function makeUser(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function makeAdmin(): Promise<string> {
  const user = await userRepo.create(q, { email: `admin${Math.random()}@example.com`, password: 'originalpass' });
  await q.query(`UPDATE users SET is_admin = true WHERE id = $1`, [user.id]);
  return user.id;
}

function adminReq(url: string, adminId: string | null, init?: Parameters<typeof authedReq>[2]) {
  return authedReq(url, adminId, init, { isAdmin: true });
}

/** A buyer with a synced Stripe customer on their subscription — the only thing applyReferralReward reads. */
async function giveStripeCustomer(buyerId: string, customerId: string, status = 'trialing'): Promise<void> {
  await q.query(
    `INSERT INTO subscriptions (buyer_id, plan, status, stripe_customer_id, current_period_end)
     VALUES ($1, 'family', $2, $3, now() + interval '7 days')`,
    [buyerId, status, customerId],
  );
}

async function makeRedeemedReferral(): Promise<{ referrer: string; redeemer: string; referral: Referral }> {
  const referrer = await makeUser(`ref${Math.random()}@example.com`);
  const redeemer = await makeUser(`red${Math.random()}@example.com`);
  const code = await referralRepo.generate(q, referrer);
  const referral = await referralRepo.redeem(q, code.code, {
    redeemerId: redeemer,
    householdHash: `hh-${Math.random()}`,
  });
  return { referrer, redeemer, referral };
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
  stripeMock.createBalanceTransaction.mockReset();
  stripeMock.getAlphaPlanPrice.mockReset().mockResolvedValue({ amountCents: 5900, currency: 'usd' });
  sentryMock.captureException.mockReset();
  let txnCounter = 0;
  stripeMock.createBalanceTransaction.mockImplementation(async () => ({ id: `cbtxn_${++txnCounter}` }));
});

describe('applyReferralReward', () => {
  it('happy path: credits both sides one month, idempotency keys distinct, audit-logged', async () => {
    const { referrer, redeemer, referral } = await makeRedeemedReferral();
    await giveStripeCustomer(referrer, 'cus_referrer');
    await giveStripeCustomer(redeemer, 'cus_referred');

    const reward = await applyReferralReward(q, referral);
    expect(reward?.status).toBe('applied');
    expect(reward?.referrer_status).toBe('applied');
    expect(reward?.referred_status).toBe('applied');

    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledTimes(2);
    const calls = stripeMock.createBalanceTransaction.mock.calls;
    const customerIds = calls.map((c) => c[0]).sort();
    expect(customerIds).toEqual(['cus_referred', 'cus_referrer']);
    for (const call of calls) {
      expect(call[1].amount).toBe(-5900);
      expect(call[1].currency).toBe('usd');
    }
    const keys = calls.map((c) => c[2].idempotencyKey).sort();
    expect(keys).toEqual([`referral-reward:${referral.id}:referred`, `referral-reward:${referral.id}:referrer`]);

    const { rows } = await q.query(
      `SELECT action, meta FROM audit_log WHERE action = 'referral_reward_apply' AND target_id = $1`,
      [referral.id],
    );
    expect(rows).toHaveLength(2);
  });

  it('duplicate application attempt is a no-op — no double Stripe call', async () => {
    const { referrer, redeemer, referral } = await makeRedeemedReferral();
    await giveStripeCustomer(referrer, 'cus_referrer');
    await giveStripeCustomer(redeemer, 'cus_referred');

    await applyReferralReward(q, referral);
    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledTimes(2);

    await applyReferralReward(q, referral);
    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledTimes(2); // unchanged
  });

  it('concurrent redemption/apply attempts for the same referral: exactly one Stripe call per side', async () => {
    const { referrer, redeemer, referral } = await makeRedeemedReferral();
    await giveStripeCustomer(referrer, 'cus_referrer');
    await giveStripeCustomer(redeemer, 'cus_referred');

    await Promise.all([applyReferralReward(q, referral), applyReferralReward(q, referral)]);
    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledTimes(2);

    const reward = await referralRewardRepo.getByReferralId(q, referral.id);
    expect(reward?.status).toBe('applied');
  });

  it('Stripe API failure on one side: that side fails and is retryable, alerts Sentry, other side unaffected', async () => {
    const { referrer, redeemer, referral } = await makeRedeemedReferral();
    await giveStripeCustomer(referrer, 'cus_referrer');
    await giveStripeCustomer(redeemer, 'cus_referred');
    stripeMock.createBalanceTransaction.mockImplementation(async (customerId: string) => {
      if (customerId === 'cus_referrer') throw new Error('Stripe API unreachable');
      return { id: 'cbtxn_ok' };
    });

    const reward = await applyReferralReward(q, referral);
    expect(reward?.referrer_status).toBe('failed');
    expect(reward?.referrer_failure_reason).toBe('Stripe API unreachable');
    expect(reward?.referred_status).toBe('applied');
    expect(reward?.status).toBe('partial');
    expect(sentryMock.captureException).toHaveBeenCalled();

    // The redemption itself must survive a reward-application failure.
    const persisted = await referralRepo.getById(q, referral.id);
    expect(persisted?.redeemed_at).not.toBeNull();
  });

  it('referrer with no Stripe customer: fails without alerting Sentry (expected/common, self-resolving)', async () => {
    const { redeemer, referral } = await makeRedeemedReferral();
    // Referrer never subscribed — no giveStripeCustomer call for them.
    await giveStripeCustomer(redeemer, 'cus_referred');

    const reward = await applyReferralReward(q, referral);
    expect(reward?.referrer_status).toBe('failed');
    expect(reward?.referrer_failure_reason).toBe('no_stripe_customer');
    expect(reward?.referred_status).toBe('applied');
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });

  it('referrer on a canceled subscription but with an existing Stripe customer: credit still succeeds', async () => {
    const { referrer, redeemer, referral } = await makeRedeemedReferral();
    await giveStripeCustomer(referrer, 'cus_referrer', 'canceled');
    await giveStripeCustomer(redeemer, 'cus_referred');

    const reward = await applyReferralReward(q, referral);
    expect(reward?.referrer_status).toBe('applied');
  });

  it('price-lookup failure: no reward row created, cleanly retryable', async () => {
    const { referral } = await makeRedeemedReferral();
    stripeMock.getAlphaPlanPrice.mockRejectedValue(new Error('STRIPE_PRICE_ID is not set.'));

    const result = await applyReferralReward(q, referral);
    expect(result).toBeNull();
    expect(await referralRewardRepo.getByReferralId(q, referral.id)).toBeNull();
    expect(stripeMock.createBalanceTransaction).not.toHaveBeenCalled();

    const { rows } = await q.query(
      `SELECT action FROM audit_log WHERE action = 'referral_reward_price_lookup_failed' AND target_id = $1`,
      [referral.id],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('GET /api/admin/referral-rewards', () => {
  it('401s without an admin session', async () => {
    const res = await rewardsListGET(adminReq('http://localhost/api/admin/referral-rewards', null));
    expect(res.status).toBe(401);
  });

  it('lists rewards, optionally filtered by status, and audit-logs the view', async () => {
    const admin = await makeAdmin();
    const { referrer, redeemer, referral } = await makeRedeemedReferral();
    await giveStripeCustomer(referrer, 'cus_referrer');
    await giveStripeCustomer(redeemer, 'cus_referred');
    await applyReferralReward(q, referral);

    const res = await rewardsListGET(adminReq('http://localhost/api/admin/referral-rewards', admin));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rewards).toHaveLength(1);

    const filtered = await rewardsListGET(
      adminReq('http://localhost/api/admin/referral-rewards?status=failed', admin),
    );
    expect((await filtered.json()).rewards).toHaveLength(0);

    const { rows } = await q.query(`SELECT action FROM audit_log WHERE action = 'view_referral_rewards'`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/admin/referral-rewards/:referralId', () => {
  it('401s without an admin session', async () => {
    const res = await rewardGET(adminReq('http://localhost/api/admin/referral-rewards/x', null), {
      params: { referralId: 'x' },
    });
    expect(res.status).toBe(401);
  });

  it('404s an unknown referral id', async () => {
    const admin = await makeAdmin();
    const res = await rewardGET(
      adminReq('http://localhost/api/admin/referral-rewards/00000000-0000-0000-0000-000000000000', admin),
      { params: { referralId: '00000000-0000-0000-0000-000000000000' } },
    );
    expect(res.status).toBe(404);
  });

  it('returns the reward detail', async () => {
    const admin = await makeAdmin();
    const { referrer, redeemer, referral } = await makeRedeemedReferral();
    await giveStripeCustomer(referrer, 'cus_referrer');
    await giveStripeCustomer(redeemer, 'cus_referred');
    await applyReferralReward(q, referral);

    const res = await rewardGET(
      adminReq(`http://localhost/api/admin/referral-rewards/${referral.id}`, admin),
      { params: { referralId: referral.id } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).reward.status).toBe('applied');
  });
});

describe('POST /api/admin/referral-rewards/:referralId/retry', () => {
  it('401s without an admin session', async () => {
    const res = await retryPOST(
      adminReq('http://localhost/api/admin/referral-rewards/x/retry', null, { method: 'POST' }),
      { params: { referralId: 'x' } },
    );
    expect(res.status).toBe(401);
  });

  it('404s an unknown referral id', async () => {
    const admin = await makeAdmin();
    const res = await retryPOST(
      adminReq('http://localhost/api/admin/referral-rewards/00000000-0000-0000-0000-000000000000/retry', admin, {
        method: 'POST',
      }),
      { params: { referralId: '00000000-0000-0000-0000-000000000000' } },
    );
    expect(res.status).toBe(404);
  });

  it('retries a failed side and audit-logs the manual retry with the admin as actor', async () => {
    const admin = await makeAdmin();
    const { redeemer, referral } = await makeRedeemedReferral();
    await giveStripeCustomer(redeemer, 'cus_referred');
    // Referrer starts with no Stripe customer -> fails.
    let reward = await applyReferralReward(q, referral);
    expect(reward?.referrer_status).toBe('failed');

    // Referrer subsequently subscribes.
    await giveStripeCustomer(reward!.referrer_user_id!, 'cus_referrer_late');

    const res = await retryPOST(
      adminReq(`http://localhost/api/admin/referral-rewards/${referral.id}/retry`, admin, { method: 'POST' }),
      { params: { referralId: referral.id } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).reward.status).toBe('applied');

    const { rows } = await q.query(
      `SELECT actor_id FROM audit_log WHERE action = 'referral_reward_retry' AND target_id = $1`,
      [referral.id],
    );
    expect(rows[0].actor_id).toBe(admin);
  });
});

describe('POST /api/admin/referral-rewards/:referralId/reverse', () => {
  it('401s without an admin session', async () => {
    const res = await reversePOST(
      adminReq('http://localhost/api/admin/referral-rewards/x/reverse', null, {
        method: 'POST',
        body: JSON.stringify({ side: 'referrer' }),
      }),
      { params: { referralId: 'x' } },
    );
    expect(res.status).toBe(401);
  });

  it('400s an invalid side', async () => {
    const admin = await makeAdmin();
    const res = await reversePOST(
      adminReq('http://localhost/api/admin/referral-rewards/x/reverse', admin, {
        method: 'POST',
        body: JSON.stringify({ side: 'both' }),
      }),
      { params: { referralId: 'x' } },
    );
    expect(res.status).toBe(400);
  });

  it('409s reversing a side that is not currently applied', async () => {
    const admin = await makeAdmin();
    const { redeemer, referral } = await makeRedeemedReferral();
    await giveStripeCustomer(redeemer, 'cus_referred');
    await applyReferralReward(q, referral); // referrer has no customer -> stays failed

    const res = await reversePOST(
      adminReq(`http://localhost/api/admin/referral-rewards/${referral.id}/reverse`, admin, {
        method: 'POST',
        body: JSON.stringify({ side: 'referrer' }),
      }),
      { params: { referralId: referral.id } },
    );
    expect(res.status).toBe(409);
  });

  it('reverses an applied side with an offsetting balance transaction, audit-logged, then 409s a second reversal', async () => {
    const admin = await makeAdmin();
    const { referrer, redeemer, referral } = await makeRedeemedReferral();
    await giveStripeCustomer(referrer, 'cus_referrer');
    await giveStripeCustomer(redeemer, 'cus_referred');
    await applyReferralReward(q, referral);
    stripeMock.createBalanceTransaction.mockClear();
    stripeMock.createBalanceTransaction.mockResolvedValue({ id: 'cbtxn_reversal' });

    const res = await reversePOST(
      adminReq(`http://localhost/api/admin/referral-rewards/${referral.id}/reverse`, admin, {
        method: 'POST',
        body: JSON.stringify({ side: 'referrer' }),
      }),
      { params: { referralId: referral.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reward.referrer_status).toBe('reversed');

    const call = stripeMock.createBalanceTransaction.mock.calls[0];
    expect(call[0]).toBe('cus_referrer');
    expect(call[1].amount).toBe(5900); // positive: offsets the earlier -5900 credit
    expect(call[2].idempotencyKey).toBe(`referral-reward-reverse:${referral.id}:referrer`);

    const { rows } = await q.query(
      `SELECT actor_id FROM audit_log WHERE action = 'referral_reward_reverse' AND target_id = $1`,
      [referral.id],
    );
    expect(rows[0].actor_id).toBe(admin);

    const second = await reversePOST(
      adminReq(`http://localhost/api/admin/referral-rewards/${referral.id}/reverse`, admin, {
        method: 'POST',
        body: JSON.stringify({ side: 'referrer' }),
      }),
      { params: { referralId: referral.id } },
    );
    expect(second.status).toBe(409);
  });
});
