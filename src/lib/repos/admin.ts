import type { Querier } from '../querier';

/**
 * Operational overview for the admin dashboard. Every number is derived directly
 * from the current DB state — no billing/cost or retention metrics yet (those
 * need usage + subscription tracking that isn't wired), so we surface only what
 * is real rather than fabricating vanity figures.
 */
export interface AdminOverview {
  buyers: number;
  parents_total: number;
  parents_activated: number;
  conversations_total: number;
  conversations_7d: number;
  open_flags: number;
  summaries_sent: number;
  waitlist: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function count(q: Querier, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await q.query<{ n: number }>(sql, params);
  return rows[0]?.n ?? 0;
}

export const adminRepo = {
  async overview(q: Querier, ref: Date = new Date()): Promise<AdminOverview> {
    const weekAgo = new Date(ref.getTime() - 7 * DAY_MS);

    const [
      buyers,
      parents_total,
      parents_activated,
      conversations_total,
      conversations_7d,
      open_flags,
      summaries_sent,
      waitlist,
    ] = await Promise.all([
      count(q, `SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL`),
      count(q, `SELECT COUNT(*)::int AS n FROM parents WHERE deleted_at IS NULL`),
      count(
        q,
        `SELECT COUNT(*)::int AS n FROM parents WHERE deleted_at IS NULL AND activated_at IS NOT NULL`,
      ),
      count(q, `SELECT COUNT(*)::int AS n FROM conversations`),
      count(q, `SELECT COUNT(*)::int AS n FROM conversations WHERE started_at >= $1`, [weekAgo]),
      count(q, `SELECT COUNT(*)::int AS n FROM safety_flags WHERE status IN ('open', 'reviewing')`),
      count(q, `SELECT COUNT(*)::int AS n FROM weekly_summaries WHERE status = 'sent'`),
      count(q, `SELECT COUNT(*)::int AS n FROM waitlist_signups`),
    ]);

    return {
      buyers,
      parents_total,
      parents_activated,
      conversations_total,
      conversations_7d,
      open_flags,
      summaries_sent,
      waitlist,
    };
  },
};
