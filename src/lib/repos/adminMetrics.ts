import type { Querier } from '../querier';
import { weekBounds } from './summary';

/**
 * Admin cost & retention metrics — see docs/admin_metrics_definitions.md for
 * the written definitions this file implements (active user, voice minute,
 * W1/W2/W4 retention windows, cost formulas). Computed directly from
 * conversations/conversation_turns/parents/usage_costs — deliberately NOT
 * from analytics_events, since the events those KPIs were originally
 * documented against (talk_session_started, voice_minute_logged,
 * parent_activated) are never actually emitted anywhere in this codebase.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

async function count(q: Querier, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await q.query<{ n: number }>(sql, params);
  return rows[0]?.n ?? 0;
}

export interface RetentionWindow {
  eligible: number;
  retained: number;
  pct: number | null;
}

export interface RetentionMetrics {
  w1: RetentionWindow;
  w2: RetentionWindow;
  w4: RetentionWindow;
}

// Discrete, non-overlapping day windows post parents.activated_at (the
// parent's "first active day"): W1 = days 1-7, W2 = days 8-14, W4 = days
// 22-28. Not cumulative — a parent silent in week 1 but active in week 2
// still counts for W2.
const RETENTION_WINDOWS: Record<keyof RetentionMetrics, { startDay: number; endDay: number }> = {
  w1: { startDay: 1, endDay: 7 },
  w2: { startDay: 8, endDay: 14 },
  w4: { startDay: 22, endDay: 28 },
};

/**
 * One retention window: `eligible` is the cohort whose window has fully
 * elapsed as of `ref` (activated_at + endDay days <= ref) — a parent
 * activated too recently to have completed the window isn't counted as
 * either eligible or retained yet, rather than skewing the denominator down.
 * `retained` is the subset of that same cohort with >=1 conversation whose
 * started_at falls within [activated_at + startDay days, activated_at +
 * (endDay+1) days).
 */
async function retentionWindow(
  q: Querier,
  ref: Date,
  startDay: number,
  endDay: number,
): Promise<RetentionWindow> {
  const [eligible, retained] = await Promise.all([
    count(
      q,
      `SELECT COUNT(*)::int AS n FROM parents
       WHERE deleted_at IS NULL AND activated_at IS NOT NULL
         AND activated_at <= $1::timestamptz - ($2 || ' days')::interval`,
      [ref, endDay],
    ),
    count(
      q,
      `SELECT COUNT(DISTINCT p.id)::int AS n FROM parents p
       JOIN conversations c ON c.parent_id = p.id
       WHERE p.deleted_at IS NULL AND p.activated_at IS NOT NULL
         AND p.activated_at <= $1::timestamptz - ($2 || ' days')::interval
         AND c.started_at >= p.activated_at + ($3 || ' days')::interval
         AND c.started_at <  p.activated_at + ($4 || ' days')::interval`,
      [ref, endDay, startDay, endDay + 1],
    ),
  ]);
  return { eligible, retained, pct: eligible === 0 ? null : retained / eligible };
}

export type Granularity = 'day' | 'week';

export interface CostBucket {
  bucket_start: string;
  active_users: number;
  voice_minutes: number;
  stt_cost_micros: number;
  tts_cost_micros: number;
  total_cost_micros: number;
  cost_per_active_user_micros: number | null;
  cost_per_voice_minute_micros: number | null;
}

/** Day bucket = 'YYYY-MM-DD'; week bucket = Monday-anchored ISO week start (reuses summary.ts's weekBounds). */
function bucketKey(d: Date, granularity: Granularity): string {
  return granularity === 'day' ? d.toISOString().slice(0, 10) : weekBounds(d).periodStart;
}

interface BucketAccumulator {
  active_users: Set<string>;
  voice_minutes: number;
  stt_cost_micros: number;
  tts_cost_micros: number;
}

export const adminMetricsRepo = {
  async retention(q: Querier, ref: Date = new Date()): Promise<RetentionMetrics> {
    const [w1, w2, w4] = await Promise.all(
      (Object.keys(RETENTION_WINDOWS) as (keyof RetentionMetrics)[]).map((key) => {
        const { startDay, endDay } = RETENTION_WINDOWS[key];
        return retentionWindow(q, ref, startDay, endDay);
      }),
    );
    return { w1, w2, w4 };
  },

  /**
   * Cost-per-active-user and cost-per-voice-minute, bucketed by day or week.
   * Cost rows and conversations are fetched raw and bucketed in JS (not SQL
   * date_trunc) to avoid depending on date-bucketing functions in pg-mem,
   * matching the rest of this codebase's convention (see summary.ts's
   * weekBounds, reused here for the week case).
   */
  async costBuckets(
    q: Querier,
    granularity: Granularity,
    ref: Date = new Date(),
    lookbackBuckets = 30,
  ): Promise<CostBucket[]> {
    const bucketMs = granularity === 'day' ? DAY_MS : 7 * DAY_MS;
    const since = new Date(ref.getTime() - lookbackBuckets * bucketMs);

    const [costRows, convRows] = await Promise.all([
      q.query<{ created_at: string; provider: 'deepgram_stt' | 'elevenlabs_tts'; cost_micros: string }>(
        `SELECT created_at, provider, cost_micros FROM usage_costs
         WHERE created_at >= $1 AND created_at <= $2`,
        [since, ref],
      ),
      q.query<{ parent_id: string; started_at: string; voice_minutes: string }>(
        `SELECT parent_id, started_at, voice_minutes FROM conversations
         WHERE started_at >= $1 AND started_at <= $2`,
        [since, ref],
      ),
    ]);

    const buckets = new Map<string, BucketAccumulator>();
    const bucketFor = (key: string): BucketAccumulator => {
      let b = buckets.get(key);
      if (!b) {
        b = { active_users: new Set(), voice_minutes: 0, stt_cost_micros: 0, tts_cost_micros: 0 };
        buckets.set(key, b);
      }
      return b;
    };

    for (const row of costRows.rows) {
      const b = bucketFor(bucketKey(new Date(row.created_at), granularity));
      const micros = Number(row.cost_micros);
      if (row.provider === 'deepgram_stt') b.stt_cost_micros += micros;
      else b.tts_cost_micros += micros;
    }

    for (const row of convRows.rows) {
      const b = bucketFor(bucketKey(new Date(row.started_at), granularity));
      b.active_users.add(row.parent_id);
      b.voice_minutes += Number(row.voice_minutes);
    }

    return Array.from(buckets.entries())
      .sort(([a], [bKey]) => a.localeCompare(bKey))
      .map(([bucket_start, b]) => {
        const active_users = b.active_users.size;
        const total_cost_micros = b.stt_cost_micros + b.tts_cost_micros;
        return {
          bucket_start,
          active_users,
          voice_minutes: b.voice_minutes,
          stt_cost_micros: b.stt_cost_micros,
          tts_cost_micros: b.tts_cost_micros,
          total_cost_micros,
          cost_per_active_user_micros: active_users === 0 ? null : Math.round(total_cost_micros / active_users),
          cost_per_voice_minute_micros:
            b.voice_minutes === 0 ? null : Math.round(total_cost_micros / b.voice_minutes),
        };
      });
  },
};
