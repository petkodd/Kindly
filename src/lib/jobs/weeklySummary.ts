import type { Querier } from '../querier';
import { summaryRepo, weekBounds, lastCompletedWeekRef } from '../repos/summary';
import { consentRepo } from '../repos/consent';

export { lastCompletedWeekRef };

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
  /** Auto-sent summaries (buyer opted in, decision D5) and how many deliveries went out. */
  sent: { parentId: string; delivered: number }[];
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
  auto_send_summaries: boolean;
  email_verified_at: string | Date | null;
}


/**
 * `generate_weekly_summary` (api_plan_v1.md): for every active parent, build a
 * `preview` weekly_summaries row for the just-completed week. Buyers who opted
 * in to automatic sending (users.auto_send_summaries, decision D5) get it sent
 * to their accepted recipients; everyone else reviews it and sends by hand.
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
    sent: [],
  };

  // Cursor on the last processed parent id. Seeded from a prior run's nextCursor.
  let cursorId: string | null = opts.after?.id ?? null;

  for (;;) {
    const { rows: parents } = cursorId
      ? await q.query<ParentRow>(
          `SELECT p.id, p.first_name, u.auto_send_summaries, u.email_verified_at FROM parents p JOIN users u ON u.id = p.buyer_id
            WHERE p.activated_at IS NOT NULL AND p.deleted_at IS NULL AND u.deleted_at IS NULL AND p.id > $2
            ORDER BY p.id ASC
            LIMIT $1`,
          [batchSize, cursorId],
        )
      : await q.query<ParentRow>(
          `SELECT p.id, p.first_name, u.auto_send_summaries, u.email_verified_at FROM parents p JOIN users u ON u.id = p.buyer_id
            WHERE p.activated_at IS NOT NULL AND p.deleted_at IS NULL AND u.deleted_at IS NULL
            ORDER BY p.id ASC
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
        // Decision D5: buyers who opted in get it sent automatically. No
        // accepted recipients yet is not a failure, just nothing to send.
        // Only for confirmed buyer emails (an unverified account can't send in its name).
        if (p.auto_send_summaries && p.email_verified_at) {
          const recipients = await consentRepo.listAcceptedRecipients(q, p.id);
          if (recipients.length > 0) {
            const { deliveries } = await summaryRepo.send(q, p.id, p.first_name, reference);
            result.sent.push({ parentId: p.id, delivered: deliveries.filter((d) => d.status === 'sent').length });
          }
        }
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
