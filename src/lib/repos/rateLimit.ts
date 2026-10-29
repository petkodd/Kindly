import type { Querier } from '../querier';

/**
 * Fixed-window rate limiter, DB-backed so the count is shared across serverless
 * instances. `hit` records one attempt for `key` and reports whether the caller
 * is still within `limit` for the current window.
 *
 * Atomic: one INSERT … ON CONFLICT DO UPDATE … RETURNING both starts a fresh
 * window (when there is no row, or the old window has expired) and increments
 * an open one. Postgres takes a row lock for the upsert, so concurrent hits on
 * the same key are serialized and each sees its own count. (The previous
 * SELECT-then-UPDATE could lose increments under concurrency.)
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
    // A window that started at or before this instant has expired.
    const expiredBefore = new Date(Date.now() - opts.windowMs);
    const { rows } = await q.query<{ count: number }>(
      `INSERT INTO auth_rate_limit AS r (key, window_start, count)
       VALUES ($1, now(), 1)
       ON CONFLICT (key) DO UPDATE SET
         count        = CASE WHEN r.window_start <= $2 THEN 1 ELSE r.count + 1 END,
         window_start = CASE WHEN r.window_start <= $2 THEN now() ELSE r.window_start END
       RETURNING count`,
      [key, expiredBefore],
    );
    const count = Number(rows[0].count);
    return { allowed: count <= opts.limit, count };
  },

  /** Clear a key's counter (e.g. after a successful login). */
  async reset(q: Querier, key: string): Promise<void> {
    await q.query(`DELETE FROM auth_rate_limit WHERE key = $1`, [key]);
  },
};
