import { createHash, randomBytes } from 'node:crypto';
import type { Querier } from '../querier';
import { ValidationError } from '../types';
import { EMAIL_RE } from '../validation';

/**
 * Founding Family Beta invitations. Same hash-only storage contract as
 * magicLinkRepo/accessTokenRepo: the raw token is returned exactly ONCE, at
 * issue time, and is never persisted, logged, or echoed back anywhere else —
 * only its SHA-256 hash is stored, and only that hash is ever queried on.
 */

export type BetaInviteStatus = 'pending' | 'redeemed' | 'expired' | 'revoked';

export interface BetaInvite {
  id: string;
  email_normalized: string;
  token_hash: string;
  status: BetaInviteStatus;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by_user_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

// >= 32 cryptographically secure random bytes, base64url-encoded — same
// primitive and length as accessTokenRepo/magicLinkRepo's tokens.
const TOKEN_BYTES = 32;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Trim + lowercase so email matching never depends on the DB's collation (CITEXT in prod, plain TEXT in tests). */
export function normalizeInviteEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}

export const betaInviteRepo = {
  /**
   * Issue a one-time invite for an email. Returns the raw token ONCE; only
   * the hash is stored. `ttlDays` comes from the caller's already-validated
   * FOUNDING_FAMILY_BETA_DAYS (see lib/foundingBeta.ts) — this repo re-checks
   * it's a positive integer but doesn't itself apply the feature's bound.
   */
  async issue(
    q: Querier,
    input: { email: string; ttlDays: number; createdByUserId?: string | null },
  ): Promise<{ token: string; invite: BetaInvite }> {
    const email = normalizeInviteEmail(input.email);
    if (!EMAIL_RE.test(email)) throw new ValidationError('a valid email is required');
    if (!Number.isInteger(input.ttlDays) || input.ttlDays <= 0) {
      throw new ValidationError('ttlDays must be a positive integer');
    }
    const raw = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);
    const { rows } = await q.query<BetaInvite>(
      `INSERT INTO beta_invites (email_normalized, token_hash, expires_at, created_by_user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [email, hashToken(raw), expiresAt.toISOString(), input.createdByUserId ?? null],
    );
    return { token: raw, invite: rows[0] };
  },

  /** Revoke a still-pending invite. No-op (returns null) if it's already redeemed/expired/revoked. */
  async revoke(q: Querier, id: string): Promise<BetaInvite | null> {
    const { rows } = await q.query<BetaInvite>(
      `UPDATE beta_invites SET status = 'revoked', updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** All invites, most recent first — for the operator tool's `list` command. */
  async list(q: Querier): Promise<BetaInvite[]> {
    const { rows } = await q.query<BetaInvite>(`SELECT * FROM beta_invites ORDER BY created_at DESC`);
    return rows;
  },

  /**
   * Look up an invite by its raw token. Returns null for an unknown token —
   * callers must not distinguish "unknown" from any other invalid state
   * (expired/revoked/redeemed) in what they show the client, to avoid an
   * oracle for guessing tokens or enumerating invited emails.
   */
  async findByToken(q: Querier, rawToken: string): Promise<BetaInvite | null> {
    if (!rawToken) return null;
    const { rows } = await q.query<BetaInvite>(`SELECT * FROM beta_invites WHERE token_hash = $1`, [hashToken(rawToken)]);
    return rows[0] ?? null;
  },

  /**
   * Atomically flip a pending, unexpired invite to 'redeemed'. The
   * `WHERE status = 'pending' AND expires_at > now()` guard is the sole
   * concurrency control (same pattern as referralRepo.redeem's
   * `redeemed_at IS NULL` guard) — of any number of parallel requests for the
   * same token, at most one UPDATE can match and return a row. Returns null
   * (does not throw) on no match; the caller re-reads to tell "someone else
   * already won this exact redemption" from "not valid" — see the route.
   */
  async markRedeemed(q: Querier, id: string, redeemedByUserId: string): Promise<BetaInvite | null> {
    const { rows } = await q.query<BetaInvite>(
      `UPDATE beta_invites
          SET status = 'redeemed', redeemed_at = now(), redeemed_by_user_id = $2, updated_at = now()
        WHERE id = $1 AND status = 'pending' AND expires_at > now()
        RETURNING *`,
      [id, redeemedByUserId],
    );
    return rows[0] ?? null;
  },
};
