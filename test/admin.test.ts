import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { adminRepo } from '../src/lib/repos/admin';

let q: Querier;

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

beforeEach(() => {
  q = makeTestDb();
});

describe('adminRepo.overview', () => {
  it('counts only live/relevant rows from real DB state', async () => {
    const ref = new Date('2026-07-06T12:00:00Z');

    // Buyers: 2 live + 1 soft-deleted (excluded).
    const buyerA = await makeBuyer('a@example.com');
    await makeBuyer('b@example.com');
    const deleted = await makeBuyer('gone@example.com');
    await q.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [deleted]);

    // Parents: 2 total, 1 activated.
    const p1 = await parentRepo.create(q, { buyerId: buyerA, firstName: 'Robert', relationship: 'father' });
    await parentRepo.create(q, { buyerId: buyerA, firstName: 'Nadia', relationship: 'mother' });
    await q.query(`UPDATE parents SET activated_at = now() WHERE id = $1`, [p1.id]);

    // Conversations: 2 within 7 days, 1 older.
    const recent = new Date(ref.getTime() - 2 * 86400000);
    const old = new Date(ref.getTime() - 10 * 86400000);
    for (const ts of [recent, recent, old]) {
      await q.query(`INSERT INTO conversations (parent_id, started_at) VALUES ($1, $2)`, [p1.id, ts]);
    }

    // Safety flags: open + reviewing count as open; resolved does not.
    await q.query(`INSERT INTO safety_flags (parent_id, severity, status) VALUES ($1, 'p2_welfare', 'open')`, [p1.id]);
    await q.query(`INSERT INTO safety_flags (parent_id, severity, status) VALUES ($1, 'p0_crisis', 'reviewing')`, [p1.id]);
    await q.query(`INSERT INTO safety_flags (parent_id, severity, status) VALUES ($1, 'p3_abuse', 'resolved')`, [p1.id]);

    // Weekly summaries: 1 sent, 1 draft (only sent counts).
    await q.query(
      `INSERT INTO weekly_summaries (parent_id, period_start, period_end, status) VALUES ($1, '2026-06-29', '2026-07-05', 'sent')`,
      [p1.id],
    );
    await q.query(
      `INSERT INTO weekly_summaries (parent_id, period_start, period_end, status) VALUES ($1, '2026-06-22', '2026-06-28', 'draft')`,
      [p1.id],
    );

    // Waitlist.
    await q.query(`INSERT INTO waitlist_signups (email) VALUES ('w1@example.com'), ('w2@example.com')`);

    const o = await adminRepo.overview(q, ref);
    expect(o).toEqual({
      buyers: 2,
      parents_total: 2,
      parents_activated: 1,
      conversations_total: 3,
      conversations_7d: 2,
      open_flags: 2,
      summaries_sent: 1,
      waitlist: 2,
    });
  });

  it('returns all-zero on an empty database', async () => {
    const o = await adminRepo.overview(q);
    expect(o).toEqual({
      buyers: 0,
      parents_total: 0,
      parents_activated: 0,
      conversations_total: 0,
      conversations_7d: 0,
      open_flags: 0,
      summaries_sent: 0,
      waitlist: 0,
    });
  });
});
