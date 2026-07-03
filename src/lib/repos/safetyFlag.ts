import type { Querier } from '../querier';
import type { SafetySeverity } from '../ai';
import {
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
    const { rows } = await q.query<SafetyFlag>(
      `INSERT INTO safety_flags (parent_id, conversation_id, severity, detail)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.parentId, input.conversationId ?? null, SCAN_TO_SEVERITY[input.severity], input.detail],
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
