import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { adminMetricsRepo } from '../src/lib/repos/adminMetrics';

let q: Querier;

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function makeParent(buyerId: string, activatedAt: Date | null): Promise<string> {
  const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });
  if (activatedAt) {
    await q.query(`UPDATE parents SET activated_at = $2 WHERE id = $1`, [parent.id, activatedAt]);
  }
  return parent.id;
}

async function makeConversation(parentId: string, startedAt: Date, voiceMinutes = 0): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO conversations (parent_id, started_at, voice_minutes) VALUES ($1, $2, $3) RETURNING id`,
    [parentId, startedAt, voiceMinutes],
  );
  return rows[0].id;
}

async function makeCostRow(
  parentId: string,
  conversationId: string,
  provider: 'deepgram_stt' | 'elevenlabs_tts',
  costMicros: number,
  createdAt: Date,
): Promise<void> {
  const { rows: turnRows } = await q.query<{ id: string }>(
    `INSERT INTO conversation_turns (conversation_id, role, content) VALUES ($1, 'parent', 'x') RETURNING id`,
    [conversationId],
  );
  await q.query(
    `INSERT INTO usage_costs
       (turn_id, conversation_id, parent_id, provider, unit, quantity, unit_rate_micros, cost_micros, created_at)
     VALUES ($1, $2, $3, $4, 'second', 1, $5, $5, $6)`,
    [turnRows[0].id, conversationId, parentId, provider, costMicros, createdAt],
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  q = makeTestDb();
});

describe('adminMetricsRepo.retention', () => {
  it('computes eligible/retained/pct per discrete W1/W2/W4 window', async () => {
    const ref = new Date('2026-07-20T12:00:00Z');
    const buyerId = await makeBuyer('buyer@example.com');

    // A: activated 10 days ago — W1 window fully elapsed, W2/W4 are not.
    // Has a conversation on day 3 post-activation -> retained for W1 only.
    const a = await makeParent(buyerId, new Date('2026-07-10T12:00:00Z'));
    await makeConversation(a, new Date('2026-07-13T12:00:00Z'));

    // B: activated 30 days ago — all windows elapsed. Conversation on day 10
    // post-activation -> falls in the W2 window [8,14), not W1 or W4.
    const b = await makeParent(buyerId, new Date('2026-06-20T12:00:00Z'));
    await makeConversation(b, new Date('2026-06-30T12:00:00Z'));

    // C: activated 30 days ago (eligible for all windows), but never returns.
    await makeParent(buyerId, new Date('2026-06-20T12:00:00Z'));

    // D: activated only 2 days ago — no window has elapsed yet, excluded entirely.
    const d = await makeParent(buyerId, new Date('2026-07-18T12:00:00Z'));
    await makeConversation(d, new Date('2026-07-19T00:00:00Z'));

    const retention = await adminMetricsRepo.retention(q, ref);

    expect(retention.w1).toEqual({ eligible: 3, retained: 1, pct: 1 / 3 });
    expect(retention.w2).toEqual({ eligible: 2, retained: 1, pct: 1 / 2 });
    expect(retention.w4).toEqual({ eligible: 2, retained: 0, pct: 0 });
  });

  it('returns pct: null (not NaN/crash) when no parent is eligible yet for a window', async () => {
    const ref = new Date('2026-07-20T12:00:00Z');
    const buyerId = await makeBuyer('buyer2@example.com');
    // Activated too recently for any window to have elapsed.
    await makeParent(buyerId, new Date('2026-07-19T12:00:00Z'));

    const retention = await adminMetricsRepo.retention(q, ref);

    expect(retention.w1).toEqual({ eligible: 0, retained: 0, pct: null });
    expect(retention.w2).toEqual({ eligible: 0, retained: 0, pct: null });
    expect(retention.w4).toEqual({ eligible: 0, retained: 0, pct: null });
  });

  it('returns all-null on an empty database', async () => {
    const retention = await adminMetricsRepo.retention(q, new Date('2026-07-20T12:00:00Z'));
    expect(retention.w1).toEqual({ eligible: 0, retained: 0, pct: null });
    expect(retention.w2).toEqual({ eligible: 0, retained: 0, pct: null });
    expect(retention.w4).toEqual({ eligible: 0, retained: 0, pct: null });
  });
});

describe('adminMetricsRepo.costBuckets', () => {
  it('buckets active users, voice minutes, and cost by day, with correct division-by-zero handling', async () => {
    const ref = new Date('2026-07-19T23:00:00Z');
    const buyerId = await makeBuyer('buyer3@example.com');

    // Day 2026-07-18: one active parent, 2.5 voice minutes, $0.15 total cost.
    const p1 = await makeParent(buyerId, new Date('2026-07-01T00:00:00Z'));
    const conv1 = await makeConversation(p1, new Date('2026-07-18T10:00:00Z'), 2.5);
    await makeCostRow(p1, conv1, 'deepgram_stt', 100_000, new Date('2026-07-18T10:01:00Z'));
    await makeCostRow(p1, conv1, 'elevenlabs_tts', 50_000, new Date('2026-07-18T10:01:30Z'));

    // Day 2026-07-19: one active parent, but zero voice minutes and zero cost.
    const p2 = await makeParent(buyerId, new Date('2026-07-01T00:00:00Z'));
    await makeConversation(p2, new Date('2026-07-19T09:00:00Z'), 0);

    // Day 2026-07-17: cost rows with no conversation started that day -> zero active users.
    const conv3 = await makeConversation(p1, new Date('2026-07-10T00:00:00Z'), 0);
    await makeCostRow(p1, conv3, 'deepgram_stt', 40_000, new Date('2026-07-17T08:00:00Z'));

    const buckets = await adminMetricsRepo.costBuckets(q, 'day', ref, 30);
    const byDay = new Map(buckets.map((b) => [b.bucket_start, b]));

    expect(byDay.get('2026-07-18')).toEqual({
      bucket_start: '2026-07-18',
      active_users: 1,
      voice_minutes: 2.5,
      stt_cost_micros: 100_000,
      tts_cost_micros: 50_000,
      total_cost_micros: 150_000,
      cost_per_active_user_micros: 150_000,
      cost_per_voice_minute_micros: 60_000,
    });

    expect(byDay.get('2026-07-19')).toEqual({
      bucket_start: '2026-07-19',
      active_users: 1,
      voice_minutes: 0,
      stt_cost_micros: 0,
      tts_cost_micros: 0,
      total_cost_micros: 0,
      cost_per_active_user_micros: 0,
      cost_per_voice_minute_micros: null, // zero voice minutes -> null, not a crash
    });

    expect(byDay.get('2026-07-17')).toEqual({
      bucket_start: '2026-07-17',
      active_users: 0,
      voice_minutes: 0,
      stt_cost_micros: 40_000,
      tts_cost_micros: 0,
      total_cost_micros: 40_000,
      cost_per_active_user_micros: null, // zero active users -> null, not a crash
      cost_per_voice_minute_micros: null,
    });
  });

  it('returns an empty array on an empty database', async () => {
    const buckets = await adminMetricsRepo.costBuckets(q, 'day', new Date('2026-07-20T12:00:00Z'));
    expect(buckets).toEqual([]);
  });

  it('buckets by week when granularity is "week"', async () => {
    const ref = new Date('2026-07-20T12:00:00Z'); // Monday 2026-07-20
    const buyerId = await makeBuyer('buyer4@example.com');
    const p1 = await makeParent(buyerId, new Date('2026-07-01T00:00:00Z'));
    // Two sessions in the same ISO week (Mon 07-13 .. Sun 07-19).
    await makeConversation(p1, new Date('2026-07-14T00:00:00Z'), 1);
    await makeConversation(p1, new Date('2026-07-16T00:00:00Z'), 2);

    const buckets = await adminMetricsRepo.costBuckets(q, 'week', ref, 8);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].bucket_start).toBe('2026-07-13'); // Monday-anchored week start
    expect(buckets[0].active_users).toBe(1);
    expect(buckets[0].voice_minutes).toBe(3);
  });
});
