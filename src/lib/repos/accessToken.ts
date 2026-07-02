import { createHash, randomBytes } from 'node:crypto';
import type { Querier } from '../querier';
import { NotFoundError } from '../types';

/**
 * Passwordless "talk link" tokens for the parent. The buyer issues one; the
 * parent uses it as a bearer token on /api/talk/*. We store only a SHA-256 hash
 * (never the raw token — see token_hash UNIQUE in the schema) and return the raw
 * value exactly once at issue time.
 */

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export const accessTokenRepo = {
  /** Issue a token for a parent. Returns the raw token ONCE; only the hash is stored. */
  async issue(
    q: Querier,
    parentId: string,
    opts: { expiresAt?: string | null } = {},
  ): Promise<{ token: string; id: string }> {
    const raw = randomBytes(32).toString('base64url');
    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO parent_access_tokens (parent_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [parentId, hashToken(raw), opts.expiresAt ?? null],
    );
    return { token: raw, id: rows[0].id };
  },

  /**
   * Resolve a raw token to its parent_id. Throws NotFoundError when the token is
   * unknown, revoked, or expired — the caller maps that to 401/404 and never
   * distinguishes the reason (no oracle for token guessing).
   */
  async resolveParentId(q: Querier, raw: string): Promise<string> {
    if (!raw) throw new NotFoundError('Invalid access token');
    const { rows } = await q.query<{ parent_id: string }>(
      `SELECT parent_id FROM parent_access_tokens
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())`,
      [hashToken(raw)],
    );
    if (rows.length === 0) throw new NotFoundError('Invalid access token');
    return rows[0].parent_id;
  },

  /** Revoke every active token for a parent (buyer-initiated). */
  async revokeAll(q: Querier, parentId: string): Promise<void> {
    await q.query(
      `UPDATE parent_access_tokens SET revoked_at = now()
       WHERE parent_id = $1 AND revoked_at IS NULL`,
      [parentId],
    );
  },
};
