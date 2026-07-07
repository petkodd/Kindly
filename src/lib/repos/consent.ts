import { createHash, randomBytes } from 'node:crypto';
import type { Querier } from '../querier';
import { type Consent, type ConsentKind, NotFoundError, ValidationError } from '../types';
import { EMAIL_RE } from '../validation';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

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

  /**
   * Revoke a consent, enforcing tenant isolation in the same statement: the
   * consent must belong to a parent owned by `buyerId`. A consent that doesn't
   * exist, is already revoked, or belongs to another buyer throws NotFound —
   * never distinguishing 403 from 404 (same rule as parentRepo.getOwned).
   */
  async revokeForBuyer(q: Querier, consentId: string, buyerId: string): Promise<void> {
    const { rows } = await q.query<{ id: string }>(
      // Scoped to summary_recipient on purpose: this route only removes
      // recipients. Revoking a buyer_attestation / parent_conversation consent
      // here would silently break the activation and first-message gates.
      `UPDATE consents SET revoked_at = now()
        WHERE id = $1 AND revoked_at IS NULL AND kind = 'summary_recipient'
          AND parent_id IN (
            SELECT id FROM parents WHERE buyer_id = $2 AND deleted_at IS NULL
          )
        RETURNING id`,
      [consentId, buyerId],
    );
    if (rows.length === 0) throw new NotFoundError('Consent not found');
  },

  /**
   * Invite a sibling as a summary recipient. Creates a summary_recipient consent
   * in a PENDING state — the recipient must accept before any summary is
   * delivered — and returns a raw invite token ONCE (only its hash is stored).
   */
  async recordRecipientInvite(
    q: Querier,
    input: { parentId: string; grantedBy?: string | null; recipientEmail: string },
  ): Promise<{ consent: Consent; inviteToken: string }> {
    const email = (input.recipientEmail ?? '').trim();
    if (!EMAIL_RE.test(email)) throw new ValidationError('a valid recipient email is required');
    const inviteToken = randomBytes(24).toString('base64url');
    const { rows } = await q.query<Consent>(
      `INSERT INTO consents (parent_id, kind, granted_by, detail)
       VALUES ($1, 'summary_recipient', $2, $3)
       RETURNING *`,
      [
        input.parentId,
        input.grantedBy ?? null,
        JSON.stringify({ recipient_email: email, status: 'pending', invite_token_hash: hashToken(inviteToken) }),
      ],
    );
    return { consent: rows[0], inviteToken };
  },

  /** Accept a pending recipient invite by its raw token. Idempotent-ish: an
   *  unknown/used token is a NotFound so the endpoint never reveals validity. */
  async acceptRecipientInvite(q: Querier, rawToken: string): Promise<Consent> {
    if (!rawToken) throw new NotFoundError('Invite not found');
    const { rows } = await q.query<Consent>(
      `SELECT * FROM consents
       WHERE kind = 'summary_recipient' AND revoked_at IS NULL
         AND detail->>'invite_token_hash' = $1
         AND detail->>'status' = 'pending'`,
      [hashToken(rawToken)],
    );
    const consent = rows[0];
    if (!consent) throw new NotFoundError('Invite not found');
    const detail = { ...(consent.detail ?? {}), status: 'accepted' };
    const { rows: updated } = await q.query<Consent>(
      `UPDATE consents SET detail = $2 WHERE id = $1 RETURNING *`,
      [consent.id, JSON.stringify(detail)],
    );
    return updated[0];
  },

  /**
   * Summary recipients eligible for delivery: active, and NOT pending. Legacy
   * consents recorded without a status (e.g. seeded directly) count as eligible;
   * only an explicit 'pending' status is excluded.
   */
  async listAcceptedRecipients(q: Querier, parentId: string): Promise<Consent[]> {
    const { rows } = await q.query<Consent>(
      `SELECT * FROM consents
       WHERE parent_id = $1 AND kind = 'summary_recipient' AND revoked_at IS NULL
         AND (detail->>'status' IS NULL OR detail->>'status' <> 'pending')
       ORDER BY granted_at ASC`,
      [parentId],
    );
    return rows;
  },

  /**
   * Safe recipient view for the buyer UI: { id, email, status } only. The token
   * hash in detail never leaves the repo boundary. Status normalization mirrors
   * listAcceptedRecipients — a legacy consent with no explicit status counts as
   * accepted; only an explicit 'pending' is pending.
   */
  async listRecipients(q: Querier, parentId: string): Promise<SummaryRecipientView[]> {
    const rows = await consentRepo.list(q, parentId, 'summary_recipient');
    return rows.map((c) => {
      const detail = (c.detail ?? {}) as { recipient_email?: string; status?: string };
      return {
        id: c.id,
        email: detail.recipient_email ?? '',
        status: detail.status === 'pending' ? 'pending' : 'accepted',
      };
    });
  },
};

/** The only recipient fields the buyer UI needs — never the invite token hash. */
export interface SummaryRecipientView {
  id: string;
  email: string;
  status: 'pending' | 'accepted';
}
