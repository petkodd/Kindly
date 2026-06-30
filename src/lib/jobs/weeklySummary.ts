import type { Querier } from '../querier';
import { summaryRepo, weekBounds } from '../repos/summary';

export interface WeeklySummaryJobResult {
  /** The week the run targeted (inclusive Monday … Sunday). */
  periodStart: string;
  periodEnd: string;
  /** Number of active parents processed (generated + failed). */
  processed: number;
  /** False if the run hit `maxParents` before exhausting active parents. */
  done: boolean;
  generated: { parentId: string; summaryId: string }[];
  failed: { parentId: string; error: string }[];
}

export interface WeeklySummaryJobOptions {
  /** Parents fetched per page; bounds memory and query size. */
  batchSize?: number;
  /** Safety cap on parents processed in one invocation (guards the cron's
   *  max duration). When hit, the run returns `done: false`. */
  maxParents?: number;
}

const DEFAULT_BATCH_SIZE = 100;

/**
 * A reference timestamp inside the most recently *completed* ISO week. The
 * buyer-facing `preview` endpoint summarizes the in-progress current week; the
 * weekly cron instead finalizes the week that just ended, so the result is
 * stable no matter the exact minute the cron fires.
 */
export function lastCompletedWeekRef(now: Date = new Date()): Date {
  // 1ms before this week's Monday lands on last week's Sunday 23:59:59.999.
  return new Date(weekBounds(now).startTs.getTime() - 1);
}

/**
 * `generate_weekly_summary` (api_plan_v1.md): for every active parent, build a
 * `preview` weekly_summaries row for the just-completed week. The buyer later
 * reviews it and triggers send.
 *
 * Idempotent — re-running refreshes the same per-parent/week rows
 * (`summaryRepo.preview` is keyed on parent + period_start) and never rewrites
 * a summary that has already been sent. One parent's failure is recorded and
 * does not abort the batch.
 *
 * Parents are processed in pages of `batchSize` so a single invocation never
 * loads the whole cohort into memory, and `maxParents` caps how much one run
 * attempts — at scale, split the cohort across runs / a queue rather than risk
 * the cron function's max duration.
 */
export async function generateWeeklySummaries(
  q: Querier,
  ref?: Date,
  opts: WeeklySummaryJobOptions = {},
): Promise<WeeklySummaryJobResult> {
  const reference = ref ?? lastCompletedWeekRef();
  const bounds = weekBounds(reference);
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxParents = opts.maxParents ?? Number.POSITIVE_INFINITY;

  const result: WeeklySummaryJobResult = {
    periodStart: bounds.periodStart,
    periodEnd: bounds.periodEnd,
    processed: 0,
    done: true,
    generated: [],
    failed: [],
  };

  let offset = 0;
  for (;;) {
    const { rows: parents } = await q.query<{ id: string; first_name: string }>(
      `SELECT id, first_name FROM parents
        WHERE activated_at IS NOT NULL AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT $1 OFFSET $2`,
      [batchSize, offset],
    );
    if (parents.length === 0) break;

    for (const p of parents) {
      if (result.processed >= maxParents) {
        result.done = false;
        return result;
      }
      try {
        const summary = await summaryRepo.preview(q, p.id, p.first_name, reference);
        result.generated.push({ parentId: p.id, summaryId: summary.id });
      } catch (err) {
        result.failed.push({
          parentId: p.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      result.processed += 1;
    }

    if (parents.length < batchSize) break;
    offset += parents.length;
  }

  return result;
}
