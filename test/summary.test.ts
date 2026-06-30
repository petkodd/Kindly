import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { consentRepo } from '../src/lib/repos/consent';
import { summaryRepo, weekBounds } from '../src/lib/repos/summary';
import { PreconditionError } from '../src/lib/types';

let q: Querier;

// Fixed reference inside the ISO week Mon 2026-06-29 .. Sun 2026-07-05.
const REF = new Date('2026-06-30T12:00:00Z'); // a Tuesday

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function seedParent(): Promise<{ id: string; firstName: string }> {
  const buyer = await makeBuyer('sarah@example.com');
  const parent = await parentRepo.create(q, {
    buyerId: buyer,
    firstName: 'Robert',
    relationship: 'father',
  });
  return { id: parent.id, firstName: parent.first_name };
}

async function addConversation(
  parentId: string,
  startedAt: string,
  summaryText: string | null,
  mood: string | null,
): Promise<void> {
  await q.query(
    `INSERT INTO conversations (parent_id, started_at, ended_at, channel, summary_text, mood_signal)
     VALUES ($1, $2, $2, 'voice', $3, $4)`,
    [parentId, new Date(startedAt), summaryText, mood],
  );
}

beforeEach(() => {
  q = makeTestDb();
});

describe('weekBounds', () => {
  it('anchors to the Monday of the ISO week (UTC)', () => {
    const b = weekBounds(REF);
    expect(b.periodStart).toBe('2026-06-29');
    expect(b.periodEnd).toBe('2026-07-05');
  });

  it('Monday maps to itself; Sunday stays in the same week', () => {
    expect(weekBounds(new Date('2026-06-29T00:00:00Z')).periodStart).toBe('2026-06-29');
    expect(weekBounds(new Date('2026-07-05T23:59:59Z')).periodStart).toBe('2026-06-29');
  });
});

describe('weekly summary preview', () => {
  it('with no conversations: gentle "didn\'t hear from" body, no concern', async () => {
    const { id, firstName } = await seedParent();
    const s = await summaryRepo.preview(q, id, firstName, REF);
    expect(s.status).toBe('preview');
    expect(s.has_concern).toBe(false);
    expect(s.body_short).toContain("didn't hear from Robert");
    // DATE comes back as a string in prod (pg) and a Date in pg-mem — normalize.
    expect(new Date(s.period_start).toISOString().slice(0, 10)).toBe('2026-06-29');
  });

  it('summarizes the week and flags a respectful concern on a low mood', async () => {
    const { id, firstName } = await seedParent();
    await addConversation(id, '2026-06-29T10:00:00Z', 'Talked about the garden.', 'warm');
    await addConversation(id, '2026-07-01T15:00:00Z', 'Reminisced about Margaret.', 'low');
    // Outside the week — must not be counted.
    await addConversation(id, '2026-07-06T09:00:00Z', 'Next week chat.', 'warm');

    const s = await summaryRepo.preview(q, id, firstName, REF);
    expect(s.body_short).toContain('2 conversations');
    expect(s.body_long).toContain('Talked about the garden.');
    expect(s.body_long).toContain('Reminisced about Margaret.');
    expect(s.body_long).not.toContain('Next week chat.');
    expect(s.has_concern).toBe(true);
    expect(s.body_long?.toLowerCase()).toContain('heads-up');
  });

  it('is idempotent per week — refreshes the same row, never duplicates', async () => {
    const { id, firstName } = await seedParent();
    await addConversation(id, '2026-06-29T10:00:00Z', 'First chat.', 'warm');
    const first = await summaryRepo.preview(q, id, firstName, REF);

    await addConversation(id, '2026-07-02T10:00:00Z', 'Second chat.', 'warm');
    const second = await summaryRepo.preview(q, id, firstName, REF);

    expect(second.id).toBe(first.id);
    expect(second.body_short).toContain('2 conversations');
    const all = await summaryRepo.list(q, id);
    expect(all).toHaveLength(1);
  });
});

describe('weekly summary send (consent-gated)', () => {
  it('refuses to send with no consented recipient (409)', async () => {
    const { id, firstName } = await seedParent();
    await expect(summaryRepo.send(q, id, firstName, REF)).rejects.toBeInstanceOf(
      PreconditionError,
    );
  });

  it('delivers to each consented recipient and marks the summary sent', async () => {
    const { id, firstName } = await seedParent();
    await addConversation(id, '2026-06-29T10:00:00Z', 'A good week.', 'warm');
    await consentRepo.record(q, {
      parentId: id,
      kind: 'summary_recipient',
      detail: { recipient_email: 'mike@example.com' },
    });

    const { summary, deliveries } = await summaryRepo.send(q, id, firstName, REF);
    expect(summary.status).toBe('sent');
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].channel).toBe('email');
    expect(deliveries[0].status).toBe('sent');
  });

  it('re-previewing after send does not downgrade a sent summary', async () => {
    const { id, firstName } = await seedParent();
    await consentRepo.record(q, { parentId: id, kind: 'summary_recipient' });
    const { summary } = await summaryRepo.send(q, id, firstName, REF);
    expect(summary.status).toBe('sent');

    const rePreviewed = await summaryRepo.preview(q, id, firstName, REF);
    expect(rePreviewed.status).toBe('sent');
    expect(rePreviewed.id).toBe(summary.id);
  });

  it('only revoked recipients means no consent — send is blocked', async () => {
    const { id, firstName } = await seedParent();
    const c = await consentRepo.record(q, { parentId: id, kind: 'summary_recipient' });
    await consentRepo.revoke(q, c.id);
    await expect(summaryRepo.send(q, id, firstName, REF)).rejects.toBeInstanceOf(
      PreconditionError,
    );
  });
});
