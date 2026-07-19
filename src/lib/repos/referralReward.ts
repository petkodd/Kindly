import type { Querier } from '../querier';
import { NotFoundError } from '../types';

export type RewardSide = 'referrer' | 'referred';
export type RewardSideStatus = 'pending' | 'processing' | 'applied' | 'failed' | 'reversed';
export type RewardOverallStatus = 'pending' | 'partial' | 'applied' | 'failed' | 'reversed';

export interface ReferralReward {
  id: string;
  referral_id: string;
  referrer_user_id: string | null;
  referred_user_id: string | null;
  reward_type: string;
  amount_cents: number;
  currency: string;
  referrer_status: RewardSideStatus;
  referred_status: RewardSideStatus;
  referrer_stripe_object_id: string | null;
  referred_stripe_object_id: string | null;
  referrer_failure_reason: string | null;
  referred_failure_reason: string | null;
  status: RewardOverallStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Overall reward status derived from the two independent per-side statuses —
 * lets Support read current state (idempotency criterion) without a Stripe
 * call. applied: both sides credited. pending: neither side has resolved
 * yet. failed: both sides permanently failed. reversed: nothing is
 * currently applied, and at least one side was explicitly clawed back.
 * partial: anything else (e.g. one side applied, the other failed/pending/
 * reversed) — exactly the state that tells Support a retry or reversal is
 * warranted.
 */
export function computeOverallStatus(
  referrerStatus: RewardSideStatus,
  referredStatus: RewardSideStatus,
): RewardOverallStatus {
  if (referrerStatus === 'applied' && referredStatus === 'applied') return 'applied';
  const waiting = (s: RewardSideStatus) => s === 'pending' || s === 'processing';
  if (waiting(referrerStatus) && waiting(referredStatus)) return 'pending';
  if (
    referrerStatus !== 'applied' &&
    referredStatus !== 'applied' &&
    (referrerStatus === 'reversed' || referredStatus === 'reversed')
  ) {
    return 'reversed';
  }
  if (referrerStatus === 'failed' && referredStatus === 'failed') return 'failed';
  return 'partial';
}

// A side stuck in 'processing' past this age is treated as an interrupted
// attempt (process killed mid-flight between claim and resolve) rather than
// a live one, so claimSide can reclaim it — otherwise a crash here would
// permanently block both the retry cron and the admin manual-retry tool,
// since neither would ever see 'pending' again.
const STALE_CLAIM_MS = 5 * 60 * 1000;

function sideColumns(side: RewardSide) {
  return side === 'referrer'
    ? { status: 'referrer_status', object: 'referrer_stripe_object_id', reason: 'referrer_failure_reason' }
    : { status: 'referred_status', object: 'referred_stripe_object_id', reason: 'referred_failure_reason' };
}

/** Set one side's status/object/reason and recompute the overall status in the same statement. */
async function resolveSide(
  q: Querier,
  referralId: string,
  side: RewardSide,
  newStatus: RewardSideStatus,
  extra: { stripeObjectId?: string | null; reason?: string | null },
): Promise<ReferralReward> {
  const current = await referralRewardRepo.getByReferralId(q, referralId);
  if (!current) throw new NotFoundError('Referral reward not found');
  const otherStatus = side === 'referrer' ? current.referred_status : current.referrer_status;
  const overall =
    side === 'referrer'
      ? computeOverallStatus(newStatus, otherStatus)
      : computeOverallStatus(otherStatus, newStatus);
  const { status, object, reason } = sideColumns(side);
  const { rows } = await q.query<ReferralReward>(
    `UPDATE referral_rewards
        SET ${status} = $2, ${object} = $3, ${reason} = $4, status = $5, updated_at = now()
      WHERE referral_id = $1
      RETURNING *`,
    [referralId, newStatus, extra.stripeObjectId ?? null, extra.reason ?? null, overall],
  );
  if (rows.length === 0) throw new NotFoundError('Referral reward not found');
  return rows[0];
}

export const referralRewardRepo = {
  /** Idempotent row creation, keyed on referral_id (DB UNIQUE — the idempotency anchor). */
  async getOrCreatePending(
    q: Querier,
    input: {
      referralId: string;
      referrerUserId: string | null;
      referredUserId: string | null;
      amountCents: number;
      currency: string;
    },
  ): Promise<ReferralReward> {
    await q.query(
      `INSERT INTO referral_rewards (referral_id, referrer_user_id, referred_user_id, amount_cents, currency)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (referral_id) DO NOTHING`,
      [input.referralId, input.referrerUserId, input.referredUserId, input.amountCents, input.currency],
    );
    const row = await referralRewardRepo.getByReferralId(q, input.referralId);
    if (!row) throw new Error('referral_rewards row missing immediately after insert');
    return row;
  },

  async getByReferralId(q: Querier, referralId: string): Promise<ReferralReward | null> {
    const { rows } = await q.query<ReferralReward>(
      `SELECT * FROM referral_rewards WHERE referral_id = $1`,
      [referralId],
    );
    return rows[0] ?? null;
  },

  async listByStatus(q: Querier, status?: RewardOverallStatus): Promise<ReferralReward[]> {
    if (status) {
      const { rows } = await q.query<ReferralReward>(
        `SELECT * FROM referral_rewards WHERE status = $1 ORDER BY updated_at DESC`,
        [status],
      );
      return rows;
    }
    const { rows } = await q.query<ReferralReward>(`SELECT * FROM referral_rewards ORDER BY updated_at DESC`);
    return rows;
  },

  /**
   * Claim a side for processing: atomically flips pending or failed ->
   * processing (failed must stay retryable — see the "failure handling"
   * acceptance criterion), or reclaims a 'processing' row stuck past
   * STALE_CLAIM_MS (e.g. a process killed mid-flight between claim and
   * resolve). Returns false (does nothing) if the side is live-processing,
   * already applied, or reversed. This CAS is what makes concurrent
   * applyReferralReward invocations (redeem route + admin retry + retry cron
   * + a race between two redemption attempts) safe without a DB transaction —
   * mirrors referralRepo.redeem's own `WHERE redeemed_at IS NULL` guard.
   */
  async claimSide(q: Querier, referralId: string, side: RewardSide): Promise<boolean> {
    const { status } = sideColumns(side);
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    const { rows } = await q.query(
      `UPDATE referral_rewards SET ${status} = 'processing', updated_at = now()
        WHERE referral_id = $1
          AND (${status} = 'pending' OR ${status} = 'failed' OR (${status} = 'processing' AND updated_at < $2))
        RETURNING id`,
      [referralId, staleBefore],
    );
    return rows.length > 0;
  },

  async markSideApplied(
    q: Querier,
    referralId: string,
    side: RewardSide,
    stripeObjectId: string,
  ): Promise<ReferralReward> {
    return resolveSide(q, referralId, side, 'applied', { stripeObjectId });
  },

  async markSideFailed(q: Querier, referralId: string, side: RewardSide, reason: string): Promise<ReferralReward> {
    return resolveSide(q, referralId, side, 'failed', { reason });
  },

  /** stripeObjectId is the offsetting (reversal) balance transaction's id, not the original credit's. */
  async markSideReversed(
    q: Querier,
    referralId: string,
    side: RewardSide,
    stripeObjectId: string,
  ): Promise<ReferralReward> {
    return resolveSide(q, referralId, side, 'reversed', { stripeObjectId });
  },
};
