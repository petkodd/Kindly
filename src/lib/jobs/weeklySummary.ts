import type { Querier } from '../querier';
import { summaryRepo, weekBounds } from '../repos/summary';

export interface WeeklySummaryJobResult {
  /** The week the run targeted (inclusive Monday … Sunday). */
  periodStart: string;
  periodEnd: string;
  generated: { parentId: string; summaryId: string }[];
  failed: { parentId: string; error: string }[];
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
 */
export async function generateWeeklySummaries(
  q: Querier,
  ref?: Date,
): Promise<WeeklySummaryJobResult> {
  const reference = ref ?? lastCompletedWeekRef();
  const bounds = weekBounds(reference);

  const { rows: parents } = await q.query<{ id: string; first_name: string }>(
    `SELECT id, first_name FROM parents
      WHERE activated_at IS NOT NULL AND deleted_at IS NULL
      ORDER BY created_at ASC`,
  );

  const result: WeeklySummaryJobResult = {
    periodStart: bounds.periodStart,
    periodEnd: bounds.periodEnd,
    generated: [],
    failed: [],
  };

  for (const p of parents) {
    try {
      const summary = await summaryRepo.preview(q, p.id, p.first_name, reference);
      result.generated.push({ parentId: p.id, summaryId: summary.id });
    } catch (err) {
      result.failed.push({
        parentId: p.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
