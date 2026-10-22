import type { Querier } from '../querier';
import type { SafetySeverity } from '../ai';
import {
  type AlertDeliveryStatus,
  type FlagSeverity,
  type FlagStatus,
  type SafetyFlag,
  NotFoundError,
  ValidationError,
} from '../types';

/** Map the AI scan severity to the DB enum. 'none' never becomes a flag. */
const SCAN_TO_SEVERITY: Record<Exclude<SafetySeverity, 'none'>, FlagSeverity> = {
  p0: 'p0_crisis',
  p1: 'p1_acute_medical',
  p2: 'p2_welfare',
  p3: 'p3_abuse',
};

const STATUSES: FlagStatus[] = ['open', 'reviewing', 'resolved', 'dismissed'];

/**
 * Cap on `detail`. The schema requires a minimized rationale, not a transcript,
 * but the rationale is model output — enforce the bound in code so a verbose or
 * misbehaving model can't dump the parent's message (PII) into the flag.
 */
const MAX_DETAIL_LEN = 280;

/**
 * Safety flags from detect_safety_flags. detail is MINIMIZED (the classifier's
 * short rationale — never the raw transcript, per the schema comment). Open +
 * reviewing flags form the admin queue.
 */
export const safetyFlagRepo = {
  async record(
    q: Querier,
    input: {
      parentId: string;
      conversationId?: string | null;
      severity: Exclude<SafetySeverity, 'none'>;
      detail: string;
    },
  ): Promise<SafetyFlag> {
    const detail = (input.detail ?? '').trim().slice(0, MAX_DETAIL_LEN);
    const { rows } = await q.query<SafetyFlag>(
      `INSERT INTO safety_flags (parent_id, conversation_id, severity, detail)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.parentId, input.conversationId ?? null, SCAN_TO_SEVERITY[input.severity], detail],
    );
    return rows[0];
  },

  /** Admin review queue: unresolved flags, highest severity first. */
  async queue(q: Querier): Promise<SafetyFlag[]> {
    const { rows } = await q.query<SafetyFlag>(
      `SELECT * FROM safety_flags
       WHERE status IN ('open', 'reviewing')
       ORDER BY severity ASC, created_at ASC`,
      [],
    );
    return rows;
  },

  /**
   * Claim the parent's family-alert slot: true at most once per `windowMs`
   * per parent (decision D2: at most 1 alert per parent per 30 minutes).
   * The first alert ever inserts the row (a concurrent duplicate hits the
   * primary key and falls through); later ones win only if the conditional
   * UPDATE matches, and a concurrent loser re-checks that WHERE after the
   * winner's row lock and gets no row. (Not a single upsert, because pg-mem —
   * used in tests — mishandles ON CONFLICT ... WHERE / DO NOTHING RETURNING.)
   */
  async claimAlertSlot(q: Querier, parentId: string, now: Date, windowMs: number): Promise<boolean> {
    try {
      const inserted = await q.query<{ parent_id: string }>(
        `INSERT INTO safety_alert_throttle (parent_id, last_alert_at)
         SELECT $1, $2::timestamptz
          WHERE NOT EXISTS (SELECT 1 FROM safety_alert_throttle WHERE parent_id = $1)
         RETURNING parent_id`,
        [parentId, now],
      );
      if (inserted.rows.length > 0) return true;
    } catch (err) {
      // A concurrent first alert inserted the row between our check and insert.
      if ((err as { code?: string }).code !== '23505') throw err;
    }
    const cutoff = new Date(now.getTime() - windowMs);
    const updated = await q.query<{ parent_id: string }>(
      `UPDATE safety_alert_throttle
          SET last_alert_at = $2
        WHERE parent_id = $1 AND last_alert_at <= $3
        RETURNING parent_id`,
      [parentId, now, cutoff],
    );
    return updated.rows.length > 0;
  },

  /** Store the alert outcome on the flag (shown in the admin queue). */
  async recordAlertOutcome(
    q: Querier,
    flagId: string,
    outcome: {
      notifiedAt: Date | null;
      email?: AlertDeliveryStatus | null;
      sms?: AlertDeliveryStatus | null;
      admin?: AlertDeliveryStatus | null;
    },
  ): Promise<SafetyFlag> {
    const { rows } = await q.query<SafetyFlag>(
      `UPDATE safety_flags
          SET notified_at = $2,
              alert_email_status = $3,
              alert_sms_status = $4,
              alert_admin_status = $5
        WHERE id = $1
        RETURNING *`,
      [flagId, outcome.notifiedAt, outcome.email ?? null, outcome.sms ?? null, outcome.admin ?? null],
    );
    if (rows.length === 0) throw new NotFoundError('Flag not found');
    return rows[0];
  },

  /** P0/P1 flags for a parent created in [start, end) — used by the weekly summary. */
  async listCrisisForPeriod(q: Querier, parentId: string, start: Date, end: Date): Promise<SafetyFlag[]> {
    const { rows } = await q.query<SafetyFlag>(
      `SELECT * FROM safety_flags
        WHERE parent_id = $1
          AND severity IN ('p0_crisis', 'p1_acute_medical')
          AND created_at >= $2 AND created_at < $3
        ORDER BY created_at ASC`,
      [parentId, start, end],
    );
    return rows;
  },

  /** Transition a flag's status; resolving/dismissing stamps who + when. */
  async updateStatus(
    q: Querier,
    flagId: string,
    status: FlagStatus,
    resolvedBy?: string | null,
  ): Promise<SafetyFlag> {
    if (!STATUSES.includes(status)) throw new ValidationError('invalid flag status');
    const terminal = status === 'resolved' || status === 'dismissed';
    const { rows } = await q.query<SafetyFlag>(
      `UPDATE safety_flags
          SET status = $2,
              resolved_at = CASE WHEN $3 THEN now() ELSE NULL END,
              resolved_by = CASE WHEN $3 THEN $4 ELSE NULL END
        WHERE id = $1
        RETURNING *`,
      [flagId, status, terminal, resolvedBy ?? null],
    );
    if (rows.length === 0) throw new NotFoundError('Flag not found');
    return rows[0];
  },
};
