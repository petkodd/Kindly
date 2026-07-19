import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { referralRepo } from '../src/lib/repos/referral';
import { referralRewardRepo, computeOverallStatus } from '../src/lib/repos/referralReward';

let q: Querier;

async function makeUser(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function makeRedeemedReferral() {
  const referrer = await makeUser(`ref${Math.random()}@example.com`);
  const redeemer = await makeUser(`red${Math.random()}@example.com`);
  const referral = await referralRepo.generate(q, referrer);
  const redeemed = await referralRepo.redeem(q, referral.code, {
    redeemerId: redeemer,
    householdHash: `hh-${Math.random()}`,
  });
  return { referrer, redeemer, referral: redeemed };
}

beforeEach(() => {
  q = makeTestDb();
});

describe('computeOverallStatus', () => {
  it('applied only when both sides applied', () => {
    expect(computeOverallStatus('applied', 'applied')).toBe('applied');
    expect(computeOverallStatus('applied', 'pending')).toBe('partial');
  });

  it('pending only when both sides are pending/processing', () => {
    expect(computeOverallStatus('pending', 'pending')).toBe('pending');
    expect(computeOverallStatus('pending', 'processing')).toBe('pending');
    expect(computeOverallStatus('processing', 'applied')).toBe('partial');
  });

  it('failed only when both sides failed', () => {
    expect(computeOverallStatus('failed', 'failed')).toBe('failed');
    expect(computeOverallStatus('failed', 'pending')).toBe('partial');
  });

  it('reversed once nothing remains applied and at least one side was reversed', () => {
    expect(computeOverallStatus('reversed', 'reversed')).toBe('reversed');
    expect(computeOverallStatus('reversed', 'failed')).toBe('reversed');
    // A side still applied means the reward isn't fully reversed yet.
    expect(computeOverallStatus('reversed', 'applied')).toBe('partial');
  });
});

describe('referralRewardRepo', () => {
  it('getOrCreatePending is idempotent on referral_id (the DB-level idempotency anchor)', async () => {
    const { referral, referrer, redeemer } = await makeRedeemedReferral();
    const first = await referralRewardRepo.getOrCreatePending(q, {
      referralId: referral.id,
      referrerUserId: referrer,
      referredUserId: redeemer,
      amountCents: 5900,
      currency: 'usd',
    });
    const second = await referralRewardRepo.getOrCreatePending(q, {
      referralId: referral.id,
      referrerUserId: referrer,
      referredUserId: redeemer,
      amountCents: 999999, // ignored — the existing row wins
      currency: 'eur',
    });
    expect(second.id).toBe(first.id);
    expect(second.amount_cents).toBe(5900);
    expect(second.currency).toBe('usd');

    const { rows } = await q.query(`SELECT count(*)::int AS n FROM referral_rewards WHERE referral_id = $1`, [
      referral.id,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it('claimSide: only one caller wins a pending side; a second claim attempt no-ops', async () => {
    const { referral, referrer, redeemer } = await makeRedeemedReferral();
    await referralRewardRepo.getOrCreatePending(q, {
      referralId: referral.id,
      referrerUserId: referrer,
      referredUserId: redeemer,
      amountCents: 5900,
      currency: 'usd',
    });

    expect(await referralRewardRepo.claimSide(q, referral.id, 'referrer')).toBe(true);
    expect(await referralRewardRepo.claimSide(q, referral.id, 'referrer')).toBe(false);
    // The other side is independent and still claimable.
    expect(await referralRewardRepo.claimSide(q, referral.id, 'referred')).toBe(true);
  });

  it('claimSide reclaims a side stuck in processing past the staleness window (interrupted attempt)', async () => {
    const { referral, referrer, redeemer } = await makeRedeemedReferral();
    await referralRewardRepo.getOrCreatePending(q, {
      referralId: referral.id,
      referrerUserId: referrer,
      referredUserId: redeemer,
      amountCents: 5900,
      currency: 'usd',
    });
    await referralRewardRepo.claimSide(q, referral.id, 'referrer');
    // Simulate a crash mid-flight: backdate updated_at past the staleness window.
    await q.query(
      `UPDATE referral_rewards SET updated_at = now() - interval '10 minutes' WHERE referral_id = $1`,
      [referral.id],
    );
    expect(await referralRewardRepo.claimSide(q, referral.id, 'referrer')).toBe(true);
  });

  it('markSideApplied/markSideFailed update the side and recompute overall status', async () => {
    const { referral, referrer, redeemer } = await makeRedeemedReferral();
    await referralRewardRepo.getOrCreatePending(q, {
      referralId: referral.id,
      referrerUserId: referrer,
      referredUserId: redeemer,
      amountCents: 5900,
      currency: 'usd',
    });

    let reward = await referralRewardRepo.markSideApplied(q, referral.id, 'referrer', 'cbtxn_1');
    expect(reward.referrer_status).toBe('applied');
    expect(reward.referrer_stripe_object_id).toBe('cbtxn_1');
    expect(reward.status).toBe('partial'); // referred side still pending

    reward = await referralRewardRepo.markSideFailed(q, referral.id, 'referred', 'no_stripe_customer');
    expect(reward.referred_status).toBe('failed');
    expect(reward.referred_failure_reason).toBe('no_stripe_customer');
    expect(reward.status).toBe('partial');
  });

  it('markSideReversed moves a fully-applied reward to reversed once both sides are clawed back', async () => {
    const { referral, referrer, redeemer } = await makeRedeemedReferral();
    await referralRewardRepo.getOrCreatePending(q, {
      referralId: referral.id,
      referrerUserId: referrer,
      referredUserId: redeemer,
      amountCents: 5900,
      currency: 'usd',
    });
    await referralRewardRepo.markSideApplied(q, referral.id, 'referrer', 'cbtxn_r');
    await referralRewardRepo.markSideApplied(q, referral.id, 'referred', 'cbtxn_d');

    let reward = await referralRewardRepo.markSideReversed(q, referral.id, 'referrer', 'cbtxn_reverse_r');
    expect(reward.status).toBe('partial'); // referred still applied
    reward = await referralRewardRepo.markSideReversed(q, referral.id, 'referred', 'cbtxn_reverse_d');
    expect(reward.status).toBe('reversed');
  });

  it('listByStatus filters correctly', async () => {
    const a = await makeRedeemedReferral();
    const b = await makeRedeemedReferral();
    await referralRewardRepo.getOrCreatePending(q, {
      referralId: a.referral.id,
      referrerUserId: a.referrer,
      referredUserId: a.redeemer,
      amountCents: 5900,
      currency: 'usd',
    });
    await referralRewardRepo.getOrCreatePending(q, {
      referralId: b.referral.id,
      referrerUserId: b.referrer,
      referredUserId: b.redeemer,
      amountCents: 5900,
      currency: 'usd',
    });
    await referralRewardRepo.markSideFailed(q, a.referral.id, 'referrer', 'no_stripe_customer');
    await referralRewardRepo.markSideFailed(q, a.referral.id, 'referred', 'no_stripe_customer');

    expect(await referralRewardRepo.listByStatus(q, 'failed')).toHaveLength(1);
    expect(await referralRewardRepo.listByStatus(q, 'pending')).toHaveLength(1);
    expect(await referralRewardRepo.listByStatus(q)).toHaveLength(2);
  });
});
