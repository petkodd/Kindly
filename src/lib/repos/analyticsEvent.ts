import type { Querier } from '../querier';

/**
 * Server-side mirror for analytics events (see docs/analytics_events_v1.md).
 * No PII in props — callers pass user_id/parent_id references, never
 * email/name, and never conversation content.
 */
export const analyticsEventRepo = {
  async record(
    q: Querier,
    eventName: string,
    props?: Record<string, unknown> | null,
    opts?: { userId?: string | null; parentId?: string | null },
  ): Promise<void> {
    await q.query(
      `INSERT INTO analytics_events (event_name, user_id, parent_id, props)
       VALUES ($1, $2, $3, $4)`,
      [eventName, opts?.userId ?? null, opts?.parentId ?? null, props ? JSON.stringify(props) : null],
    );
  },
};
