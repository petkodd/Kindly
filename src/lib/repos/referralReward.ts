import type { Querier } from '../querier';

/**
 * Referral credit state (chat 11). One row per redeemed referral; each side
 * (referrer / referred) moves pending → processing → applied | failed on its
 * own. `claimSide` is the compare-and-set that makes double delivery of the
 * same webhook (or two different webhooks racing) apply a credit at most once.
 */

export type RewardSide = 'referrer' | 'referred';
export type RewardSideStatus = 'pending' | 'processing' | 'applied' | 'failed';

export interface ReferralReward {
  id: string;
  referral_id: string;
  referrer_user_id: string | null;
  referred_user_id: string | null;
  currency: string;
  referrer_amount_cents: number | null;
  referred_amount_cents: number | null;
  referrer_status: RewardSideStatus;
  referred_status: RewardSideStatus;
  referrer_stripe_txn_id: string | null;
  referred_stripe_txn_id: string | null;
  referrer_failure_reason: string | null;
  referred_failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** A side stuck in 'processing' this long (crash between Stripe call and DB write) may be reclaimed.
 *  The Stripe idempotency key on the balance transaction makes the re-run return the same transaction. */
export const STALE_CLAIM_MS = 15 * 60 * 1000;

// Column names come from this closed map only — never from input.
const COLS: Record<RewardSide, { status: string; txn: string; reason: string; amount: string; claimed: string }> = {
  referrer: {
    status: 'referrer_status',
    txn: 'referrer_stripe_txn_id',
    reason: 'referrer_failure_reason',
    amount: 'referrer_amount_cents',
    claimed: 'referrer_claimed_at',
  },
  referred: {
    status: 'referred_status',
    txn: 'referred_stripe_txn_id',
    reason: 'referred_failure_reason',
    amount: 'referred_amount_cents',
    claimed: 'referred_claimed_at',
  },
};

export const referralRewardRepo = {
  async getByReferralId(q: Querier, referralId: string): Promise<ReferralReward | null> {
    const { rows } = await q.query<ReferralReward>(`SELECT * FROM referral_rewards WHERE referral_id = $1`, [referralId]);
    return rows[0] ?? null;
  },

  /** The reward row for a referral, created (all sides pending) if missing. Safe under concurrency. */
  async getOrCreate(
    q: Querier,
    input: { referralId: string; referrerUserId: string; referredUserId: string },
  ): Promise<ReferralReward> {
    await q.query(
      `INSERT INTO referral_rewards (referral_id, referrer_user_id, referred_user_id)
       VALUES ($1, $2, $3) ON CONFLICT (referral_id) DO NOTHING`,
      [input.referralId, input.referrerUserId, input.referredUserId],
    );
    const row = await referralRewardRepo.getByReferralId(q, input.referralId);
    if (!row) throw new Error('referral reward row missing after insert');
    return row;
  },

  /**
   * Claim one side for processing. Succeeds (true) only if the side is
   * pending, failed, or a stale 'processing' claim; an applied side is never
   * reclaimed, so a credit is applied at most once.
   */
  async claimSide(q: Querier, referralId: string, side: RewardSide, now: Date = new Date()): Promise<boolean> {
    const c = COLS[side];
    const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
    const { rows } = await q.query(
      `UPDATE referral_rewards
          SET ${c.status} = 'processing', ${c.claimed} = $2, updated_at = $2
        WHERE referral_id = $1
          AND (${c.status} IN ('pending', 'failed')
               OR (${c.status} = 'processing' AND ${c.claimed} < $3))
        RETURNING id`,
      [referralId, now, staleBefore],
    );
    return rows.length > 0;
  },

  async markSideApplied(
    q: Querier,
    referralId: string,
    side: RewardSide,
    input: { txnId: string; amountCents: number; currency: string },
  ): Promise<void> {
    const c = COLS[side];
    await q.query(
      `UPDATE referral_rewards
          SET ${c.status} = 'applied', ${c.txn} = $2, ${c.amount} = $3, currency = $4,
              ${c.reason} = NULL, updated_at = now()
        WHERE referral_id = $1`,
      [referralId, input.txnId, input.amountCents, input.currency],
    );
  },

  async markSideFailed(q: Querier, referralId: string, side: RewardSide, reason: string): Promise<void> {
    const c = COLS[side];
    await q.query(
      `UPDATE referral_rewards
          SET ${c.status} = 'failed', ${c.reason} = $2, updated_at = now()
        WHERE referral_id = $1 AND ${c.status} <> 'applied'`,
      [referralId, reason.slice(0, 200)],
    );
  },

  /** Rewards where this user is the referrer and their side has not been applied yet. */
  async unappliedForReferrer(q: Querier, referrerUserId: string): Promise<ReferralReward[]> {
    const { rows } = await q.query<ReferralReward>(
      `SELECT * FROM referral_rewards
        WHERE referrer_user_id = $1 AND referrer_status IN ('pending', 'failed')
        ORDER BY created_at`,
      [referrerUserId],
    );
    return rows;
  },
};
