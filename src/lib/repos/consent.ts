import type { Querier } from '../querier';
import { type Consent, type ConsentKind, ValidationError } from '../types';

/**
 * Consent is the spine of Kindly's privacy model. Two gates matter most:
 *  - buyer_attestation must exist before a parent profile can be activated.
 *  - parent_conversation must exist before the first message is processed.
 *  - summary_recipient must exist (per recipient) before any summary is delivered.
 */
export const consentRepo = {
  async record(
    q: Querier,
    input: {
      parentId: string;
      kind: ConsentKind;
      grantedBy?: string | null;
      detail?: Record<string, unknown> | null;
    },
  ): Promise<Consent> {
    if (!input.parentId) throw new ValidationError('parentId is required');
    const { rows } = await q.query<Consent>(
      `INSERT INTO consents (parent_id, kind, granted_by, detail)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        input.parentId,
        input.kind,
        input.grantedBy ?? null,
        input.detail ? JSON.stringify(input.detail) : null,
      ],
    );
    return rows[0];
  },

  /** True if an active (non-revoked) consent of this kind exists for the parent. */
  async has(q: Querier, parentId: string, kind: ConsentKind): Promise<boolean> {
    const { rows } = await q.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM consents
       WHERE parent_id = $1 AND kind = $2 AND revoked_at IS NULL`,
      [parentId, kind],
    );
    return (rows[0]?.n ?? 0) > 0;
  },

  /**
   * Record a consent at most once for a parent+kind. For singleton kinds
   * (buyer_attestation, parent_conversation) this keeps repeated calls
   * idempotent instead of accumulating duplicate rows. Do NOT use for
   * summary_recipient — that kind is intentionally one row per recipient.
   */
  async ensure(
    q: Querier,
    input: {
      parentId: string;
      kind: ConsentKind;
      grantedBy?: string | null;
      detail?: Record<string, unknown> | null;
    },
  ): Promise<Consent> {
    const existing = await consentRepo.list(q, input.parentId, input.kind);
    if (existing.length > 0) return existing[0];
    return consentRepo.record(q, input);
  },

  /** List active consents of a kind (e.g. all summary recipients). */
  async list(q: Querier, parentId: string, kind: ConsentKind): Promise<Consent[]> {
    const { rows } = await q.query<Consent>(
      `SELECT * FROM consents
       WHERE parent_id = $1 AND kind = $2 AND revoked_at IS NULL
       ORDER BY granted_at ASC`,
      [parentId, kind],
    );
    return rows;
  },

  async revoke(q: Querier, consentId: string): Promise<void> {
    await q.query(
      `UPDATE consents SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [consentId],
    );
  },
};
