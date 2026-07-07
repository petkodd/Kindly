import { randomBytes } from 'node:crypto';
import type { Querier } from '../querier';
import { NotFoundError, PreconditionError, ValidationError } from '../types';

/**
 * Referral codes. A buyer generates a unique code; a new buyer redeems it at
 * signup. Fraud guard: at most one redemption per household (household_hash),
 * and you can't redeem your own code.
 */

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
const CODE_LEN = 8;

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
    const { rows: prior } = await q.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM referrals
       WHERE household_hash = $1 AND redeemed_at IS NOT NULL`,
      [input.householdHash],
    );
    if ((prior[0]?.n ?? 0) > 0) {
      throw new PreconditionError('A referral has already been redeemed for this household.');
    }
    // The `redeemed_at IS NULL` guard makes concurrent double-redeem safe.
    const { rows: updated } = await q.query<Referral>(
      `UPDATE referrals
          SET redeemed_by = $2, redeemed_at = now(), household_hash = $3
        WHERE id = $1 AND redeemed_at IS NULL
        RETURNING *`,
      [referral.id, input.redeemerId, input.householdHash],
    );
    if (updated.length === 0) throw new NotFoundError('Referral code not found or already redeemed');
    return updated[0];
  },
};
