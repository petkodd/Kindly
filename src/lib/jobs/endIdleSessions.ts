import type { Querier } from '../querier';
import { conversationRepo } from '../repos/conversation';
import { runSessionEndJobs } from './sessionEnd';

/**
 * `end_idle_sessions` (cron, daily on the Vercel Hobby plan; every 15 minutes
 * on a paid plan): a parent who closes the tab
 * or puts the tablet down never taps "I'm done for now", so their
 * conversation stayed open forever — never summarized, never stamped for
 * transcript retention. This ends every conversation with no activity for
 * IDLE_MS and runs the normal session-end jobs (summary, memory extraction,
 * retention stamping), exactly as if the parent had ended it.
 *
 * Transcript retention never depends on this job: every turn already gets a
 * 30-day retention_purge_at when it is written.
 *
 * Batched (maxPerRun) so one run stays inside the function time limit; the
 * next run picks up the rest. One conversation's failure never stops others.
 */
export const IDLE_MS = 30 * 60 * 1000;

export interface EndIdleResult {
  ended: number;
  failed: number;
  /** True when the batch limit was hit and more idle conversations may remain. */
  more: boolean;
}

export async function endIdleSessions(
  q: Querier,
  opts: { now?: Date; maxPerRun?: number } = {},
): Promise<EndIdleResult> {
  const now = opts.now ?? new Date();
  const maxPerRun = opts.maxPerRun ?? 200;
  const idleSince = new Date(now.getTime() - IDLE_MS);

  const { rows } = await q.query<{ id: string; parent_id: string }>(
    `SELECT c.id, c.parent_id FROM conversations c
       LEFT JOIN (
         SELECT conversation_id, MAX(created_at) AS last_at FROM conversation_turns GROUP BY conversation_id
       ) t ON t.conversation_id = c.id
      WHERE c.ended_at IS NULL
        AND c.started_at < $1
        AND (t.last_at IS NULL OR t.last_at < $1)
      ORDER BY c.started_at ASC
      LIMIT $2`,
    [idleSince, maxPerRun + 1],
  );

  const result: EndIdleResult = { ended: 0, failed: 0, more: rows.length > maxPerRun };
  for (const row of rows.slice(0, maxPerRun)) {
    try {
      await conversationRepo.end(q, row.id, row.parent_id);
      await runSessionEndJobs(q, row.id);
      result.ended += 1;
    } catch (err) {
      result.failed += 1;
      console.error('end-idle-sessions: failed', row.id, (err as Error).name);
    }
  }
  return result;
}
