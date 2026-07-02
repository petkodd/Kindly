import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { consentRepo } from '../src/lib/repos/consent';
import { summaryRepo } from '../src/lib/repos/summary';
import { generateWeeklySummaries, lastCompletedWeekRef } from '../src/lib/jobs/weeklySummary';

let q: Querier;

// A reference inside the ISO week Mon 2026-06-29 .. Sun 2026-07-05.
const REF = new Date('2026-06-30T12:00:00Z');

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function makeActiveParent(email: string, firstName: string): Promise<string> {
  const buyer = await makeBuyer(email);
  const parent = await parentRepo.create(q, { buyerId: buyer, firstName, relationship: 'father' });
  await consentRepo.record(q, { parentId: parent.id, kind: 'buyer_attestation', grantedBy: buyer });
  await parentRepo.activate(q, parent.id, buyer);
  return parent.id;
}

beforeEach(() => {
  q = makeTestDb();
});

describe('lastCompletedWeekRef', () => {
  it('points into the week before the one containing `now`', () => {
    // now is in week Mon 06-29..Sun 07-05 → completed week is Mon 06-22..Sun 06-28.
    const ref = lastCompletedWeekRef(REF);
    expect(ref.toISOString().slice(0, 10)).toBe('2026-06-28');
  });
});

describe('generate_weekly_summary job', () => {
  it('creates a preview row for each active parent and skips inactive ones', async () => {
    const active = await makeActiveParent('sarah@example.com', 'Robert');

    // Un-activated parent — must be skipped.
    const buyer2 = await makeBuyer('jo@example.com');
    await parentRepo.create(q, { buyerId: buyer2, firstName: 'Helen', relationship: 'mother' });

    // Activated then soft-deleted — must be skipped.
    const deleted = await makeActiveParent('deb@example.com', 'Frank');
    const { rows: delBuyer } = await q.query<{ buyer_id: string }>(
      `SELECT buyer_id FROM parents WHERE id = $1`,
      [deleted],
    );
    await parentRepo.softDelete(q, deleted, delBuyer[0].buyer_id);

    const res = await generateWeeklySummaries(q, REF);

    expect(res.generated).toHaveLength(1);
    expect(res.generated[0].parentId).toBe(active);
    expect(res.failed).toHaveLength(0);
    expect(res.periodStart).toBe('2026-06-29');

    const summaries = await summaryRepo.list(q, active);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].status).toBe('preview');
  });

  it('is idempotent — a second run refreshes the same row, never duplicates', async () => {
    const active = await makeActiveParent('sarah@example.com', 'Robert');
    const first = await generateWeeklySummaries(q, REF);
    const second = await generateWeeklySummaries(q, REF);

    expect(first.generated[0].summaryId).toBe(second.generated[0].summaryId);
    const summaries = await summaryRepo.list(q, active);
    expect(summaries).toHaveLength(1);
  });

  it('does not rewrite a summary that has already been sent', async () => {
    const active = await makeActiveParent('sarah@example.com', 'Robert');
    await consentRepo.record(q, { parentId: active, kind: 'summary_recipient' });

    // Buyer reviews + sends this week's summary.
    const { summary } = await summaryRepo.send(q, active, 'Robert', REF);
    expect(summary.status).toBe('sent');

    // A later cron pass for the same week leaves the sent row untouched.
    const res = await generateWeeklySummaries(q, REF);
    expect(res.generated[0].summaryId).toBe(summary.id);
    const summaries = await summaryRepo.list(q, active);
    expect(summaries[0].status).toBe('sent');
  });

  it('returns empty generated/failed when there are no active parents', async () => {
    const res = await generateWeeklySummaries(q, REF);
    expect(res.generated).toHaveLength(0);
    expect(res.failed).toHaveLength(0);
    expect(res.processed).toBe(0);
    expect(res.done).toBe(true);
  });

  it('processes every active parent across multiple pages', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      ids.add(await makeActiveParent(`p${i}@example.com`, `Parent${i}`));
    }
    const res = await generateWeeklySummaries(q, REF, { batchSize: 2 });
    expect(res.done).toBe(true);
    expect(res.processed).toBe(5);
    expect(new Set(res.generated.map((g) => g.parentId))).toEqual(ids);
  });

  it('stops at maxParents with a nextCursor and resumes exactly where it left off', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      ids.add(await makeActiveParent(`p${i}@example.com`, `Parent${i}`));
    }

    // First run: cap at 2, expect a resume cursor.
    const first = await generateWeeklySummaries(q, REF, { batchSize: 10, maxParents: 2 });
    expect(first.done).toBe(false);
    expect(first.processed).toBe(2);
    expect(first.nextCursor).not.toBeNull();

    // Resume from the cursor: the remaining 3, no overlap, then finished.
    const second = await generateWeeklySummaries(q, REF, {
      after: first.nextCursor,
      batchSize: 10,
    });
    expect(second.done).toBe(true);
    expect(second.nextCursor).toBeNull();
    expect(second.processed).toBe(3);

    const firstSet = new Set(first.generated.map((g) => g.parentId));
    const secondSet = new Set(second.generated.map((g) => g.parentId));
    // Disjoint halves (no parent processed twice) whose union is the whole cohort.
    for (const id of secondSet) expect(firstSet.has(id)).toBe(false);
    expect(new Set([...firstSet, ...secondSet])).toEqual(ids);
  });

  it('resuming past the last parent yields an empty, finished run', async () => {
    const id = await makeActiveParent('only@example.com', 'Robert');
    const { rows } = await q.query<{ created_at: string | Date }>(
      `SELECT created_at FROM parents WHERE id = $1`,
      [id],
    );
    const beyond = { createdAt: new Date(rows[0].created_at).toISOString(), id };

    const res = await generateWeeklySummaries(q, REF, { after: beyond });
    expect(res.done).toBe(true);
    expect(res.processed).toBe(0);
    expect(res.nextCursor).toBeNull();
  });
});
