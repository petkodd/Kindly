import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import type { AiClient, CompanionReplyInput, SafetyScanInput } from '../src/lib/ai';
import { fakeAiClient } from '../src/lib/ai/fake';
import { parentRepo } from '../src/lib/repos/parent';
import { fakeEmailClient } from '../src/lib/email/fake';
import { runCompanionTurn } from '../src/lib/ai/turn';
import { SAFE_FALLBACK_REPLY } from '../src/lib/ai/outputFilter';

let q: Querier;

async function makeParent(opts: { buyerName?: string | null; relationship?: 'mother' | 'self' } = {}) {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id`,
    [`b${Math.random()}@example.com`, opts.buyerName === undefined ? 'Sarah Miller' : opts.buyerName],
  );
  return parentRepo.create(q, { buyerId: rows[0].id, firstName: 'Ruth', relationship: opts.relationship ?? 'mother' });
}

async function convo(parentId: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO conversations (parent_id, channel) VALUES ($1, 'text') RETURNING id`,
    [parentId],
  );
  return rows[0].id;
}

function client(overrides: Partial<AiClient>): AiClient {
  return { ...fakeAiClient, ...overrides };
}

async function turn(message: string, ai: AiClient = fakeAiClient, parentOpts = {}) {
  const parent = await makeParent(parentOpts);
  const result = await runCompanionTurn(q, {
    parent,
    conversationId: await convo(parent.id),
    message,
    history: [],
    memories: [],
    channel: 'text',
    ai,
  });
  return { parent, result };
}

beforeEach(() => {
  q = makeTestDb();
  // Model a real email provider: only a real send counts as the family being notified.
  vi.spyOn(fakeEmailClient, 'send').mockResolvedValue({ id: 'provider-email-1' });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('runCompanionTurn', () => {
  it('passes a clean reply through unchanged, with no flag and no prefix', async () => {
    const { result } = await turn('I made soup today');
    expect(result.scan.severity).toBe('none');
    expect(result.flag).toBeNull();
    expect(result.replyText).toBe("It's good to talk with you, Ruth. What would you like to talk about today?");
  });

  it('tells the companion who would be alerted, and the scan sees the history', async () => {
    const companionReply = vi.fn(async (_i: CompanionReplyInput) => ({ text: 'Hello Ruth.' }));
    const safetyScan = vi.fn(async (_i: SafetyScanInput) => ({ severity: 'none' as const, rationale: 'ok' }));
    const parent = await makeParent();
    const history = [{ role: 'parent' as const, content: 'I miss Harold' }];
    await runCompanionTurn(q, {
      parent,
      conversationId: await convo(parent.id),
      message: 'hello',
      history,
      memories: [],
      channel: 'voice',
      ai: client({ companionReply, safetyScan }),
    });
    expect(companionReply.mock.calls[0][0]).toMatchObject({ alertContactFirstName: 'Sarah' });
    expect(safetyScan.mock.calls[0][0]).toEqual({ message: 'hello', history });
  });

  it("says nobody will be told when the buyer set it up for themselves ('self')", async () => {
    const { result } = await turn("I don't want to live anymore", fakeAiClient, { relationship: 'self' });
    expect(result.replyText).toMatch(/988/);
    expect(result.replyText).not.toMatch(/let .* know/);
  });

  it("falls back to 'your family' when the buyer has no name on file", async () => {
    const { result } = await turn("I don't want to live anymore", fakeAiClient, { buyerName: null });
    expect(result.replyText).toMatch(/I'm going to let your family know so they can check on you/);
  });

  it('applies the crisis prefix AFTER the filter, so the prefix is never redacted', async () => {
    const { result } = await turn('I fell down in the kitchen');
    expect(result.scan.severity).toBe('p1');
    expect(result.replyText.startsWith('Please call 911 right now')).toBe(true);
    expect(result.redacted).toBe(false);
  });

  it('P3 gets the Eldercare Locator prefix and never mentions telling family', async () => {
    const { result } = await turn('My son takes my pension card');
    expect(result.scan.severity).toBe('p3');
    expect(result.replyText).toMatch(/1-800-677-1116/);
    expect(result.replyText).not.toMatch(/let .* know|Sarah/);
  });

  it('regenerates once with the violation note; uses the retry when it is clean', async () => {
    const companionReply = vi
      .fn()
      .mockResolvedValueOnce({ text: 'I love you too, Ruth.' })
      .mockResolvedValueOnce({ text: "I'm an AI companion, but I really enjoy our chats." });
    const { result } = await turn('Do you love me?', client({ companionReply }));
    expect(companionReply).toHaveBeenCalledTimes(2);
    expect(companionReply.mock.calls[1][0].violations).toEqual(['hasFeelings']);
    expect(result).toMatchObject({ regenerated: true, redacted: false, violated: ['hasFeelings'] });
    expect(result.replyText).toBe("I'm an AI companion, but I really enjoy our chats.");
  });

  it('falls back to the safe reply when the retry fails too, or throws', async () => {
    const bad = vi.fn().mockResolvedValue({ text: "I'm a real person." });
    expect((await turn('hi', client({ companionReply: bad }))).result.replyText).toBe(SAFE_FALLBACK_REPLY);
    expect(bad).toHaveBeenCalledTimes(2); // exactly one regeneration

    const throwsOnRetry = vi.fn().mockResolvedValueOnce({ text: "I'm a real person." }).mockRejectedValueOnce(new Error('x'));
    expect((await turn('hi', client({ companionReply: throwsOnRetry }))).result.replyText).toBe(SAFE_FALLBACK_REPLY);
  });

  it('a scan failure fails safe as P2 for human review', async () => {
    const safetyScan = vi.fn().mockRejectedValue(new Error('scan down'));
    const { result } = await turn('hello', client({ safetyScan }));
    expect(result.scan.severity).toBe('p2');
    expect(result.flag?.severity).toBe('p2_welfare');
  });

  it('a crisis turn whose reply fails still gets the crisis copy + safe fallback, flag and alert (NEW-2)', async () => {
    const companionReply = vi.fn().mockRejectedValue(new Error('model down'));
    const parent = await makeParent();
    const result = await runCompanionTurn(q, {
      parent,
      conversationId: await convo(parent.id),
      message: "I don't want to live anymore",
      history: [],
      memories: [],
      channel: 'text',
      ai: client({ companionReply }),
    });
    expect(result.scan.severity).toBe('p0');
    expect(result.replyText).toMatch(/988/);
    expect(result.replyText).toMatch(/I'm going to let Sarah know/);
    expect(result.replyText.endsWith(SAFE_FALLBACK_REPLY)).toBe(true);
    expect(result.redacted).toBe(true);
    const { rows } = await q.query(`SELECT severity, notified_at FROM safety_flags WHERE parent_id = $1`, [parent.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].notified_at).not.toBeNull();
    expect(fakeEmailClient.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['p1', 'I have chest pain', /Please call 911 right now/],
    ['p3', 'My son takes my pension card', /1-800-677-1116/],
  ] as const)('a %s turn whose reply fails gets its crisis copy instead of an error', async (_sev, message, copy) => {
    const companionReply = vi.fn().mockRejectedValue(new Error('model down'));
    const { result } = await turn(message, client({ companionReply }));
    expect(result.replyText).toMatch(copy);
    expect(result.replyText.endsWith(SAFE_FALLBACK_REPLY)).toBe(true);
  });

  it('a non-crisis turn whose reply fails still throws (the route says "something went wrong")', async () => {
    const companionReply = vi.fn().mockRejectedValue(new Error('model down'));
    await expect(turn('I made soup today', client({ companionReply }))).rejects.toThrow('model down');
  });
});

describe('runCompanionTurn: the "I\'m going to let … know" clause follows the alert outcome (NEW-6)', () => {
  it('says it when the family alert was delivered', async () => {
    const { result } = await turn("I don't want to live anymore");
    expect(result.alert?.familyTold).toBe(true);
    expect(result.replyText).toMatch(/I'm going to let Sarah know so they can check on you/);
  });

  it('does not say it when the family alert failed; keeps 988/911', async () => {
    vi.mocked(fakeEmailClient.send).mockRejectedValue(new Error('provider down'));
    const { result } = await turn("I don't want to live anymore");
    expect(result.alert?.familyTold).toBe(false);
    expect(result.replyText).toMatch(/988/);
    expect(result.replyText).toMatch(/911/);
    expect(result.replyText).not.toMatch(/let .* know/);
  });

  it('does not say it when the send was only simulated outside DEMO_MODE', async () => {
    vi.mocked(fakeEmailClient.send).mockResolvedValue({ id: 'fake', simulated: true } as never);
    const { result } = await turn('I have chest pain');
    expect(result.replyText).toMatch(/Please call 911 right now/);
    expect(result.replyText).not.toMatch(/let .* know/);
  });

  it('says it for a simulated send in DEMO_MODE', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    try {
      vi.mocked(fakeEmailClient.send).mockResolvedValue({ id: 'fake', simulated: true } as never);
      const { result } = await turn('I have chest pain');
      expect(result.replyText).toMatch(/I'm going to let Sarah know/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('says it when throttled because an alert already reached the family in the window', async () => {
    const parent = await makeParent();
    const first = await runCompanionTurn(q, {
      parent, conversationId: await convo(parent.id), message: "I don't want to live anymore",
      history: [], memories: [], channel: 'text', ai: fakeAiClient,
    });
    expect(first.alert?.familyTold).toBe(true);
    const second = await runCompanionTurn(q, {
      parent, conversationId: await convo(parent.id), message: 'I have chest pain',
      history: [], memories: [], channel: 'text', ai: fakeAiClient,
    });
    expect(second.alert?.throttled).toBe(true);
    expect(second.replyText).toMatch(/I'm going to let Sarah know/);
  });
});
