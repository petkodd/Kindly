import { createHash, randomBytes } from 'node:crypto';
import type { Querier } from '../querier';
import { type Consent, type ConsentKind, NotFoundError, ValidationError, ExpiredError } from '../types';
import { EMAIL_RE } from '../validation';
import { SUMMARY_SHARING_REASK_DAYS } from '../talk/notices';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Consent is the spine of Dearly's privacy model. Two gates matter most:
 *  - buyer_attestation must exist before a parent profile can be activated.
 *  - parent_conversation must exist before the first message is processed.
 *  - summary_recipient must exist (per recipient) before any summary is delivered.
 *  - parent_summary_sharing (the parent's own "Yes" on the talk screen) must
 *    exist before any summary is sent at all (chat 9).
 */
/** Summary-recipient invites can be accepted for this many days. */
export const INVITE_TTL_DAYS = 14;

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

  /** The most recent consent row of a kind, revoked or not (null when none was ever recorded). */
  async latest(q: Querier, parentId: string, kind: ConsentKind): Promise<Consent | null> {
    const { rows } = await q.query<Consent>(
      `SELECT * FROM consents
       WHERE parent_id = $1 AND kind = $2
       ORDER BY granted_at DESC
       LIMIT 1`,
      [parentId, kind],
    );
    return rows[0] ?? null;
  },

  /**
   * Record the parent's answer to the summary-sharing notice on the talk
   * screen, with the exact notice text and version they saw.
   *  - 'yes': an active parent_summary_sharing consent (idempotent: an existing
   *    active one is returned unchanged).
   *  - 'not_now': a row revoked at once, so the answer is on record but
   *    `has()` stays false and summaries stay blocked.
   */
  async recordSummarySharingAnswer(
    q: Querier,
    input: {
      parentId: string;
      answer: 'yes' | 'not_now';
      noticeText: string;
      noticeVersion: string;
    },
  ): Promise<Consent> {
    if (!input.parentId) throw new ValidationError('parentId is required');
    const detail = {
      answer: input.answer,
      notice_text: input.noticeText,
      notice_version: input.noticeVersion,
      channel: 'talk_screen',
    };
    if (input.answer === 'yes') {
      const active = await consentRepo.list(q, input.parentId, 'parent_summary_sharing');
      if (active.length > 0) return active[0];
      return consentRepo.record(q, { parentId: input.parentId, kind: 'parent_summary_sharing', detail });
    }
    // A repeated "Not now" inside the re-ask window is the same answer: return
    // it instead of piling up rows (the talk link holder could otherwise spam).
    const last = await consentRepo.latest(q, input.parentId, 'parent_summary_sharing');
    if (
      last &&
      (last.detail as { answer?: string } | null)?.answer === 'not_now' &&
      Date.now() - new Date(last.granted_at).getTime() < SUMMARY_SHARING_REASK_DAYS * 24 * 60 * 60 * 1000
    ) {
      return last;
    }
    const { rows } = await q.query<Consent>(
      `INSERT INTO consents (parent_id, kind, granted_by, detail, revoked_at)
       VALUES ($1, 'parent_summary_sharing', NULL, $2, now())
       RETURNING *`,
      [input.parentId, JSON.stringify(detail)],
    );
    return rows[0];
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

  /**
   * What the invite page shows BEFORE anyone clicks (chat 10): who invited
   * them and whose summary it is. Read-only — opening the link (or an email
   * scanner fetching it) never accepts. Throws NotFoundError for an unknown,
   * revoked or deleted-parent invite and ExpiredError after INVITE_TTL_DAYS
   * (only a holder of the real token can tell the two apart). The recipient's
   * email and the token hash never leave the repo.
   */
  async previewRecipientInvite(
    q: Querier,
    rawToken: string,
  ): Promise<{ inviter_first_name: string | null; parent_first_name: string; status: 'pending' | 'accepted' }> {
    if (!rawToken) throw new NotFoundError('Invite not found');
    const { rows } = await q.query<{
      granted_at: string | Date;
      status: string | null;
      parent_first_name: string;
      inviter_full_name: string | null;
    }>(
      `SELECT c.granted_at, c.detail->>'status' AS status,
              p.first_name AS parent_first_name, u.full_name AS inviter_full_name
         FROM consents c
         JOIN parents p ON p.id = c.parent_id AND p.deleted_at IS NULL
         JOIN users u ON u.id = p.buyer_id AND u.deleted_at IS NULL
        WHERE c.kind = 'summary_recipient' AND c.revoked_at IS NULL
          AND c.detail->>'invite_token_hash' = $1`,
      [hashToken(rawToken)],
    );
    const row = rows[0];
    if (!row || (row.status !== 'pending' && row.status !== 'accepted')) throw new NotFoundError('Invite not found');
    if (
      row.status === 'pending' &&
      Date.now() - new Date(row.granted_at).getTime() > INVITE_TTL_DAYS * 24 * 60 * 60 * 1000
    ) {
      throw new ExpiredError('This invitation has expired. Please ask the person who invited you to send a new one.');
    }
    const first = (row.inviter_full_name ?? '').trim().split(/\s+/)[0] || null;
    return { inviter_first_name: first, parent_first_name: row.parent_first_name, status: row.status };
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
    // Invites expire after INVITE_TTL_DAYS. Only a holder of the real token
    // reaches this point, so saying "expired" reveals nothing to a guesser.
    if (Date.now() - new Date(consent.granted_at).getTime() > INVITE_TTL_DAYS * 24 * 60 * 60 * 1000) {
      throw new ExpiredError('This invitation has expired. Please ask the person who invited you to send a new one.');
    }
    const detail = { ...(consent.detail ?? {}), status: 'accepted' };
    const { rows: updated } = await q.query<Consent>(
      `UPDATE consents SET detail = $2 WHERE id = $1 RETURNING *`,
      [consent.id, JSON.stringify(detail)],
    );
    return updated[0];
  },

  /**
   * Summary recipients eligible for delivery: active, and explicitly accepted.
   * A missing/null status, 'pending', 'revoked', or any other value is NOT
   * accepted — a recipient only ever reaches 'accepted' by clicking their
   * emailed invite token (acceptRecipientInvite). Treating an absent status as
   * accepted would let a directly-inserted or malformed consent row (e.g. from
   * the now-closed /api/parents/:id/consent bypass) receive a parent's summary
   * without the recipient ever having consented.
   */
  async listAcceptedRecipients(q: Querier, parentId: string): Promise<Consent[]> {
    const { rows } = await q.query<Consent>(
      `SELECT * FROM consents
       WHERE parent_id = $1 AND kind = 'summary_recipient' AND revoked_at IS NULL
         AND detail->>'status' = 'accepted'
       ORDER BY granted_at ASC`,
      [parentId],
    );
    return rows;
  },

  /**
   * Safe recipient view for the buyer UI: { id, email, status } only. The token
   * hash in detail never leaves the repo boundary. Status normalization mirrors
   * listAcceptedRecipients — only an explicit 'accepted' reads as accepted;
   * anything else (missing, 'pending', 'revoked', ...) reads as pending.
   */
  async listRecipients(q: Querier, parentId: string): Promise<SummaryRecipientView[]> {
    const rows = await consentRepo.list(q, parentId, 'summary_recipient');
    return rows.map((c) => {
      const detail = (c.detail ?? {}) as { recipient_email?: string; status?: string };
      return {
        id: c.id,
        email: detail.recipient_email ?? '',
        status: detail.status === 'accepted' ? 'accepted' : 'pending',
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
