import { randomBytes } from 'node:crypto';
import type { Querier } from '../querier';
import { NotFoundError, PreconditionError, ValidationError } from '../types';

/**
 * Referral codes. A buyer has at most one ACTIVE (unredeemed) code; a new
 * buyer redeems it at signup or at the onboarding checkout step. Abuse guards
 * (chat 11): you can't redeem your own code; a user redeems at most one code
 * ever; the redeemer must never have had a subscription (new customers only);
 * at most one redemption per household (household_hash). The credit itself is
 * applied later, after the redeemer's first paid invoice — see
 * src/lib/billing/referralCredit.ts.
 */

/** What the referrer sees about each redemption of their codes. Never who redeemed it. */
export type ReferralStatus = 'pending' | 'credited';
export interface ReferralRedemptionView {
  redeemed_at: string;
  status: ReferralStatus;
}

export interface Referral {
  id: string;
  referrer_id: string;
  code: string;
  redeemed_by: string | null;
  redeemed_at: string | null;
  household_hash: string | null;
  created_at: string;
}

// Unambiguous alphabet (no O/0/I/1/L) for human-friendly codes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// 8 chars (~40 bits) was guessable by a distributed brute force against an
// endpoint with no rate limiting — this code gates a monetizable action
// (referral credit), so it needs real resistance to enumeration. 10 chars
// (~49 bits, log2(32)*10) keeps it practical to type by hand at signup while
// making guessing infeasible.
const CODE_LEN = 10;

function newCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let code = '';
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return code;
}

export const referralRepo = {
  /** The referrer's most recent code, or null if they've never generated one. */
  async getForBuyer(q: Querier, referrerId: string): Promise<Referral | null> {
    if (!referrerId) throw new ValidationError('referrerId is required');
    const { rows } = await q.query<Referral>(
      `SELECT * FROM referrals WHERE referrer_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [referrerId],
    );
    return rows[0] ?? null;
  },

  /** The referrer's newest code that has not been redeemed yet, or null. */
  async getActiveForBuyer(q: Querier, referrerId: string): Promise<Referral | null> {
    if (!referrerId) throw new ValidationError('referrerId is required');
    const { rows } = await q.query<Referral>(
      `SELECT * FROM referrals WHERE referrer_id = $1 AND redeemed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [referrerId],
    );
    return rows[0] ?? null;
  },

  /**
   * One active code per user: return the existing unredeemed code, or
   * generate one if every earlier code has been used. `created` says which.
   */
  async getOrCreateActive(q: Querier, referrerId: string): Promise<{ referral: Referral; created: boolean }> {
    const existing = await referralRepo.getActiveForBuyer(q, referrerId);
    if (existing) return { referral: existing, created: false };
    return { referral: await referralRepo.generate(q, referrerId), created: true };
  },

  /** The referral this user redeemed (at most one — enforced by a unique index), or null. */
  async getRedeemedBy(q: Querier, userId: string): Promise<Referral | null> {
    const { rows } = await q.query<Referral>(`SELECT * FROM referrals WHERE redeemed_by = $1`, [userId]);
    return rows[0] ?? null;
  },

  /**
   * Every redemption of this referrer's codes, newest first, with its status:
   * 'credited' once the referrer's own credit is applied, otherwise 'pending'
   * (waiting for the new family's first paid invoice). Deliberately carries no
   * redeemer identity.
   */
  async listRedemptionsForReferrer(q: Querier, referrerId: string): Promise<ReferralRedemptionView[]> {
    const { rows } = await q.query<{ redeemed_at: string | Date; referrer_status: string | null }>(
      `SELECT r.redeemed_at, rw.referrer_status
         FROM referrals r
         LEFT JOIN referral_rewards rw ON rw.referral_id = r.id
        WHERE r.referrer_id = $1 AND r.redeemed_at IS NOT NULL
        ORDER BY r.redeemed_at DESC`,
      [referrerId],
    );
    return rows.map((row) => ({
      redeemed_at: new Date(row.redeemed_at).toISOString(),
      status: row.referrer_status === 'applied' ? 'credited' : 'pending',
    }));
  },

  /** Generate a unique referral code for a referrer (retries on the rare collision). */
  async generate(q: Querier, referrerId: string): Promise<Referral> {
    if (!referrerId) throw new ValidationError('referrerId is required');
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { rows } = await q.query<Referral>(
          `INSERT INTO referrals (referrer_id, code) VALUES ($1, $2) RETURNING *`,
          [referrerId, newCode()],
        );
        return rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') continue; // code collision — retry
        throw err;
      }
    }
    throw new Error('could not generate a unique referral code');
  },

  /**
   * Redeem a code. Guards: code must exist and be unredeemed; a buyer can't
   * redeem their own code; at most one redemption per household.
   *
   * `householdHash` is REQUIRED — without it the one-per-household guard could be
   * disabled by simply omitting it. For real fraud resistance it must be derived
   * SERVER-SIDE from something the redeemer doesn't control (verified address /
   * payment fingerprint); a client-supplied value can still be spoofed per call.
   */
  async redeem(
    q: Querier,
    code: string,
    input: { redeemerId: string; householdHash: string },
  ): Promise<Referral> {
    if (!input.householdHash) throw new ValidationError('householdHash is required');
    const { rows } = await q.query<Referral>(
      `SELECT * FROM referrals WHERE code = $1`,
      [(code ?? '').trim().toUpperCase()],
    );
    const referral = rows[0];
    if (!referral || referral.redeemed_at) {
      throw new NotFoundError('Referral code not found or already redeemed');
    }
    if (referral.referrer_id === input.redeemerId) {
      throw new ValidationError('You cannot redeem your own referral code.');
    }
    if (await referralRepo.getRedeemedBy(q, input.redeemerId)) {
      throw new PreconditionError('You have already used a referral code.');
    }
    // New customers only: any earlier subscription (paid, trial, canceled or
    // beta) means this buyer is not a new family.
    const { rows: subs } = await q.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM subscriptions WHERE buyer_id = $1`,
      [input.redeemerId],
    );
    if ((subs[0]?.n ?? 0) > 0) {
      throw new PreconditionError('Referral codes are for new families only.');
    }
    const { rows: prior } = await q.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM referrals
       WHERE household_hash = $1 AND redeemed_at IS NOT NULL`,
      [input.householdHash],
    );
    if ((prior[0]?.n ?? 0) > 0) {
      throw new PreconditionError('A referral has already been redeemed for this household.');
    }
    // The `redeemed_at IS NULL` guard makes concurrent double-redeem safe.
    let updated: Referral[];
    try {
      ({ rows: updated } = await q.query<Referral>(
        `UPDATE referrals
            SET redeemed_by = $2, redeemed_at = now(), household_hash = $3
          WHERE id = $1 AND redeemed_at IS NULL
          RETURNING *`,
        [referral.id, input.redeemerId, input.householdHash],
      ));
    } catch (err) {
      // referrals_one_redemption_per_user: a concurrent redeem by the same user won.
      if ((err as { code?: string }).code === '23505') {
        throw new PreconditionError('You have already used a referral code.');
      }
      throw err;
    }
    if (updated.length === 0) throw new NotFoundError('Referral code not found or already redeemed');
    return updated[0];
  },
};
