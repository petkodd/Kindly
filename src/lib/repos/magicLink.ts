import { createHash, randomBytes } from 'node:crypto';
import type { Querier } from '../querier';
import { NotFoundError } from '../types';

/**
 * Passwordless "magic link" sign-in tokens. Same shape as accessTokenRepo (only
 * a SHA-256 hash is stored; the raw token is returned once), but short-lived
 * (15 min) and single-use — consuming a token stamps used_at so a captured
 * email link can't be replayed.
 */

const TTL_MS = 15 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export const magicLinkRepo = {
  /** Issue a token for a user. Returns the raw token ONCE; only the hash is stored. */
  async issue(q: Querier, userId: string): Promise<{ token: string; id: string }> {
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TTL_MS);
    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO magic_link_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [userId, hashToken(raw), expiresAt],
    );
    return { token: raw, id: rows[0].id };
  },

  /**
   * Consume a raw token: resolves to its user_id and marks it used in one
   * step, so a concurrent replay of the same token can't succeed twice.
   * Throws NotFoundError when the token is unknown, expired, or already used —
   * the caller maps that to a single generic response (no oracle).
   */
  async consume(q: Querier, raw: string): Promise<string> {
    if (!raw) throw new NotFoundError('Invalid or expired link');
    const { rows } = await q.query<{ user_id: string }>(
      `UPDATE magic_link_tokens
       SET used_at = now()
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > now()
       RETURNING user_id`,
      [hashToken(raw)],
    );
    if (rows.length === 0) throw new NotFoundError('Invalid or expired link');
    return rows[0].user_id;
  },
};
