import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { consentRepo } from '../src/lib/repos/consent';
import { memoryRepo } from '../src/lib/repos/memory';
import { conversationRepo } from '../src/lib/repos/conversation';
import { summaryRepo } from '../src/lib/repos/summary';
import { runSessionEndJobs } from '../src/lib/jobs/sessionEnd';

let q: Querier;

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function makeTalkingParent(): Promise<string> {
  const buyer = await makeBuyer(`b${Math.random()}@example.com`);
  const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
  await consentRepo.record(q, { parentId: parent.id, kind: 'buyer_attestation', grantedBy: buyer });
  await parentRepo.activate(q, parent.id, buyer);
  await consentRepo.record(q, { parentId: parent.id, kind: 'parent_conversation' });
  return parent.id;
}

/** Open a session and add a short transcript with an interest + a low-mood turn. */
async function haveConversation(parentId: string): Promise<string> {
  const convo = await conversationRepo.openSession(q, parentId, 'text');
  await conversationRepo.addTurn(q, convo.id, parentId, 'parent', 'I love gardening');
  await conversationRepo.addTurn(q, convo.id, parentId, 'kindly', 'That sounds lovely.');
  await conversationRepo.addTurn(q, convo.id, parentId, 'parent', 'I feel lonely today');
  await conversationRepo.end(q, convo.id, parentId);
  return convo.id;
}

beforeEach(() => {
  q = makeTestDb();
});

describe('session-end jobs', () => {
  it('writes summary_text + mood_signal and proposes memories', async () => {
    const parentId = await makeTalkingParent();
    const convoId = await haveConversation(parentId);

    const result = await runSessionEndJobs(q, convoId);
    expect(result.summarized).toBe(true);
    expect(result.moodSignal).toBe('low'); // from "lonely"
    expect(result.memoriesProposed).toBeGreaterThanOrEqual(1);

    const { rows } = await q.query<{ summary_text: string | null; mood_signal: string | null }>(
      `SELECT summary_text, mood_signal FROM conversations WHERE id = $1`,
      [convoId],
    );
    expect(rows[0].summary_text).not.toBeNull();
    expect(rows[0].mood_signal).toBe('low');

    // Extracted memories enter as 'proposed' (await confirmation), not confirmed.
    const proposed = await memoryRepo.list(q, parentId, { status: 'proposed' });
    expect(proposed.map((m) => m.mem_value).join(' ')).toContain('gardening');
  });

  it('is idempotent — a second run does not re-summarize or re-propose', async () => {
    const parentId = await makeTalkingParent();
    const convoId = await haveConversation(parentId);

    const first = await runSessionEndJobs(q, convoId);
    const before = (await memoryRepo.list(q, parentId, { status: 'proposed' })).length;
    const second = await runSessionEndJobs(q, convoId);
    const after = (await memoryRepo.list(q, parentId, { status: 'proposed' })).length;

    expect(first.summarized).toBe(true);
    expect(second.summarized).toBe(false);
    expect(after).toBe(before);
  });

  it('discards candidates below the confidence threshold', async () => {
    const parentId = await makeTalkingParent();
    const convoId = await haveConversation(parentId);

    // Fake gives the interest 0.8 and the low-mood moment 0.6.
    const result = await runSessionEndJobs(q, convoId, { minConfidence: 0.7 });
    expect(result.memoriesProposed).toBe(1); // only the 0.8 interest survives
  });

  it('no-op on an unknown conversation', async () => {
    const result = await runSessionEndJobs(q, '00000000-0000-0000-0000-000000000000');
    expect(result).toEqual({ summarized: false, moodSignal: null, memoriesProposed: 0 });
  });
});

describe('closes the loop into the weekly summary', () => {
  it('a summarized low-mood conversation surfaces as a highlight + concern', async () => {
    const parentId = await makeTalkingParent();
    const convoId = await haveConversation(parentId);
    await runSessionEndJobs(q, convoId);

    // The conversation started "now", so summarize for the current week.
    const preview = await summaryRepo.preview(q, parentId, 'Robert', new Date());
    expect(preview.has_concern).toBe(true); // low mood → respectful heads-up
    expect(preview.body_long).toContain('Robert had a'); // the per-conversation summary text
  });
});
