import type { Querier } from '../querier';

/**
 * Fixed-window rate limiter, DB-backed so the count is shared across serverless
 * instances. `hit` records one attempt for `key` and reports whether the caller
 * is still within `limit` for the current window.
 *
 * The read-then-write is not atomic, so under heavy concurrency the count can be
 * slightly under-reported — acceptable for a throttle (it's a mitigation, not a
 * hard gate). ON CONFLICT handles the insert-or-reset in one statement.
 */
export interface RateLimitResult {
  allowed: boolean;
  count: number;
}

export const rateLimitRepo = {
  async hit(
    q: Querier,
    key: string,
    opts: { limit: number; windowMs: number },
  ): Promise<RateLimitResult> {
    const { rows } = await q.query<{ window_start: string | Date; count: number }>(
      `SELECT window_start, count FROM auth_rate_limit WHERE key = $1`,
      [key],
    );
    const existing = rows[0];
    const withinWindow =
      existing && Date.now() - new Date(existing.window_start).getTime() < opts.windowMs;

    if (withinWindow) {
      const count = existing.count + 1;
      await q.query(`UPDATE auth_rate_limit SET count = $2 WHERE key = $1`, [key, count]);
      return { allowed: count <= opts.limit, count };
    }

    // No row, or the window has elapsed → start a fresh window at 1.
    await q.query(
      `INSERT INTO auth_rate_limit (key, window_start, count)
       VALUES ($1, now(), 1)
       ON CONFLICT (key) DO UPDATE SET window_start = now(), count = 1`,
      [key],
    );
    return { allowed: 1 <= opts.limit, count: 1 };
  },

  /** Clear a key's counter (e.g. after a successful login). */
  async reset(q: Querier, key: string): Promise<void> {
    await q.query(`DELETE FROM auth_rate_limit WHERE key = $1`, [key]);
  },
};
