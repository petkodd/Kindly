import type { Querier } from '../querier';
import { summaryRepo, weekBounds } from '../repos/summary';

/**
 * Keyset resume point: the last parent id a run processed. We page by `id`
 * (a uuid — an exact, total order) rather than `created_at`, because node-pg
 * truncates timestamptz to millisecond-precision Dates while Postgres stores
 * microseconds; a created_at cursor would re-match the boundary row and could
 * stall a full page. Creation order is irrelevant for a full sweep.
 */
export interface WeeklySummaryCursor {
  id: string;
}

export interface WeeklySummaryJobResult {
  /** The week the run targeted (inclusive Monday … Sunday). */
  periodStart: string;
  periodEnd: string;
  /** Number of active parents processed (generated + failed) this run. */
  processed: number;
  /** False if the run hit `maxParents` before exhausting active parents. */
  done: boolean;
  /** Resume point to pass back as `after` when `done` is false; null when finished. */
  nextCursor: WeeklySummaryCursor | null;
  generated: { parentId: string; summaryId: string }[];
  failed: { parentId: string; error: string }[];
}

export interface WeeklySummaryJobOptions {
  /** Parents fetched per page; bounds memory and query size. */
  batchSize?: number;
  /** Safety cap on parents processed in one invocation (guards the cron's
   *  max duration). When hit, the run returns `done: false` + `nextCursor`. */
  maxParents?: number;
  /** Resume after this parent (a `nextCursor` from a previous run). */
  after?: WeeklySummaryCursor | null;
}

const DEFAULT_BATCH_SIZE = 100;

interface ParentRow {
  id: string;
  first_name: string;
}

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
 * Parents are walked with keyset pagination over `id`, so paging stays O(n)
 * (no growing OFFSET re-scan) and a run capped by `maxParents` returns a
 * `nextCursor` that a later run resumes from without re-processing or skipping
 * anyone.
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
    nextCursor: null,
    generated: [],
    failed: [],
  };

  // Cursor on the last processed parent id. Seeded from a prior run's nextCursor.
  let cursorId: string | null = opts.after?.id ?? null;

  for (;;) {
    const { rows: parents } = cursorId
      ? await q.query<ParentRow>(
          `SELECT id, first_name FROM parents
            WHERE activated_at IS NOT NULL AND deleted_at IS NULL AND id > $2
            ORDER BY id ASC
            LIMIT $1`,
          [batchSize, cursorId],
        )
      : await q.query<ParentRow>(
          `SELECT id, first_name FROM parents
            WHERE activated_at IS NOT NULL AND deleted_at IS NULL
            ORDER BY id ASC
            LIMIT $1`,
          [batchSize],
        );
    if (parents.length === 0) break;

    for (const p of parents) {
      if (result.processed >= maxParents) {
        result.done = false;
        result.nextCursor = cursorId ? { id: cursorId } : null;
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
      cursorId = p.id;
    }

    if (parents.length < batchSize) break;
  }

  return result;
}
