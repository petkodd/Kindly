import type { Querier } from '../querier';
import type { Parent, SafetyFlag } from '../types';
import { dispatchSafetyAlert } from '../safety/alerts';

/**
 * Retry undelivered P0/P1 family alerts (release check NEW-3, B4).
 *
 * Picks P0/P1 flags that reached nobody in the family (`notified_at IS NULL`),
 * were not skipped because an alert already went out in the 30-minute window,
 * are still open/reviewing, are recent, and have had fewer than
 * MAX_ALERT_ATTEMPTS dispatches. Each one is dispatched again through the
 * normal D2 path (throttle, admin backup, outcome recorded on the flag).
 *
 * Runs inside the daily end-idle-sessions cron: the Vercel Hobby plan allows
 * daily crons only (a test enforces it). A sub-daily retry (e.g. every 5
 * minutes) needs a paid plan; the admin backup email is what covers the gap
 * until then. The window is 25 hours, not 24, so a daily run that starts a
 * little late still covers every flag since the previous run.
 */
export const MAX_ALERT_ATTEMPTS = 3;
export const RETRY_WINDOW_MS = 25 * 60 * 60 * 1000;

export interface RetryAlertsResult {
  retried: number;
  delivered: number;
  failed: number;
}

export async function retryUndeliveredAlerts(
  q: Querier,
  opts: { now?: Date; maxPerRun?: number } = {},
): Promise<RetryAlertsResult> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - RETRY_WINDOW_MS);
  const { rows } = await q.query<SafetyFlag>(
    `SELECT * FROM safety_flags
      WHERE severity IN ('p0_crisis', 'p1_acute_medical')
        AND notified_at IS NULL
        AND COALESCE(alert_email_status, '') <> 'suppressed_rate_limit'
        AND status IN ('open', 'reviewing')
        AND alert_attempts < $1
        AND created_at > $2
      ORDER BY created_at ASC
      LIMIT $3`,
    [MAX_ALERT_ATTEMPTS, since, opts.maxPerRun ?? 50],
  );

  const result: RetryAlertsResult = { retried: 0, delivered: 0, failed: 0 };
  for (const flag of rows) {
    try {
      const { rows: parents } = await q.query<Parent>(`SELECT * FROM parents WHERE id = $1`, [flag.parent_id]);
      const parent = parents[0];
      // Self-use: there is no family to tell; the admin was emailed at the time.
      if (!parent || parent.relationship === 'self') continue;
      result.retried += 1;
      const outcome = await dispatchSafetyAlert(q, { flag, parent, now });
      if (outcome?.notifiedAt) result.delivered += 1;
    } catch (err) {
      result.failed += 1;
      console.error('retry-alerts: failed', flag.id, (err as Error)?.name);
    }
  }
  return result;
}
