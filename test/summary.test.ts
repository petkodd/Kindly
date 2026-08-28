import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { consentRepo } from '../src/lib/repos/consent';
import { summaryRepo, weekBounds } from '../src/lib/repos/summary';
import { PreconditionError } from '../src/lib/types';
import { fakeEmailClient, resetEmailClient } from '../src/lib/email';

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
  delete process.env.EMAIL_API_KEY; // force the fake client
  resetEmailClient();
});

afterEach(() => {
  vi.restoreAllMocks();
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
    // pg (and pg-mem) parse DATE columns into JS Date objects; the repo must
    // normalize back to a plain 'YYYY-MM-DD' string, or JSON-serializing a
    // Date over the API produces a full ISO timestamp that breaks the
    // client's date-range formatting (fmtDay in family-summary/page.tsx).
    expect(s.period_start).toBe('2026-06-29');
    expect(s.period_end).toBe('2026-07-05');
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
    expect(all[0].period_start).toBe('2026-06-29');
    expect(all[0].period_end).toBe('2026-07-05');
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
      detail: { recipient_email: 'mike@example.com', status: 'accepted' },
    });

    const { summary, deliveries } = await summaryRepo.send(q, id, firstName, REF);
    expect(summary.status).toBe('sent');
    expect(summary.period_start).toBe('2026-06-29');
    expect(summary.period_end).toBe('2026-07-05');
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].channel).toBe('email');
    expect(deliveries[0].status).toBe('sent');
  });

  it('actually calls the email client with the recipient and rendered summary', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    const { id, firstName } = await seedParent();
    await addConversation(id, '2026-06-29T10:00:00Z', 'Talked about the garden.', 'warm');
    await consentRepo.record(q, {
      parentId: id,
      kind: 'summary_recipient',
      detail: { recipient_email: 'mike@example.com', status: 'accepted' },
    });

    await summaryRepo.send(q, id, firstName, REF);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = sendSpy.mock.calls[0][0];
    expect(sent.to).toBe('mike@example.com');
    expect(sent.subject).toContain(firstName);
    expect(sent.html).toContain('Talked about the garden.');
  });

  it('marks a delivery failed (and leaves the summary in preview) when the email provider errors', async () => {
    vi.spyOn(fakeEmailClient, 'send').mockRejectedValueOnce(new Error('provider down'));
    const { id, firstName } = await seedParent();
    await consentRepo.record(q, {
      parentId: id,
      kind: 'summary_recipient',
      detail: { recipient_email: 'mike@example.com', status: 'accepted' },
    });

    const { summary, deliveries } = await summaryRepo.send(q, id, firstName, REF);
    expect(deliveries[0].status).toBe('failed');
    expect(deliveries[0].sent_at).toBeNull();
    expect(summary.status).toBe('preview');

    // Retrying (e.g. the buyer clicks "send" again) resends to the same
    // recipient rather than silently no-op'ing against the failed row.
    const retry = await summaryRepo.send(q, id, firstName, REF);
    expect(retry.deliveries).toHaveLength(1);
    expect(retry.deliveries[0].id).toBe(deliveries[0].id);
    expect(retry.deliveries[0].status).toBe('sent');
    expect(retry.summary.status).toBe('sent');
  });

  it('is idempotent — sending twice does not duplicate deliveries', async () => {
    const { id, firstName } = await seedParent();
    await consentRepo.record(q, {
      parentId: id,
      kind: 'summary_recipient',
      detail: { recipient_email: 'mike@example.com', status: 'accepted' },
    });

    const first = await summaryRepo.send(q, id, firstName, REF);
    expect(first.deliveries).toHaveLength(1);

    const second = await summaryRepo.send(q, id, firstName, REF);
    expect(second.deliveries).toHaveLength(1); // returns the same delivery, not a new one
    expect(second.deliveries[0].id).toBe(first.deliveries[0].id);

    const { rows } = await q.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM summary_deliveries WHERE summary_id = $1`,
      [first.summary.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it('does not attribute the delivery to the buyer (recipient_user stays null)', async () => {
    const { id, firstName } = await seedParent();
    await consentRepo.record(q, {
      parentId: id,
      kind: 'summary_recipient',
      detail: { recipient_email: 'mike@example.com', status: 'accepted' },
    });
    const { deliveries } = await summaryRepo.send(q, id, firstName, REF);
    expect(deliveries[0].recipient_user).toBeNull();
  });

  it('re-previewing after send does not downgrade a sent summary', async () => {
    const { id, firstName } = await seedParent();
    await consentRepo.record(q, {
      parentId: id,
      kind: 'summary_recipient',
      detail: { recipient_email: 'mike@example.com', status: 'accepted' },
    });
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
