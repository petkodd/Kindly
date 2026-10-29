import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { consentRepo } from '../src/lib/repos/consent';
import { conversationRepo } from '../src/lib/repos/conversation';
import { accessTokenRepo } from '../src/lib/repos/accessToken';
import { usageCostRepo } from '../src/lib/repos/usageCost';
import { rateLimitRepo } from '../src/lib/repos/rateLimit';
import { adminMetricsRepo, parentRef } from '../src/lib/repos/adminMetrics';
import { fakeAiClient } from '../src/lib/ai/fake';
import { fakeSpeechClient } from '../src/lib/speech/fake';
import { runSessionEndJobs } from '../src/lib/jobs/sessionEnd';
import { trimHistory, HISTORY_TOKEN_BUDGET } from '../src/lib/ai/history';
import { llmCostMicros, llmRates } from '../src/lib/billing/usageRates';
import { mapTalkError } from '../src/lib/talk/errors';
import { AUDIO_MAX_BYTES, MAX_PARENT_TURNS, TEXT_MAX_CHARS } from '../src/lib/talk/limits';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { POST as messagePOST } from '../src/app/api/talk/message/route';
import { POST as voicePOST, maxDuration as voiceMaxDuration } from '../src/app/api/talk/voice/route';
import { POST as sessionPOST } from '../src/app/api/talk/session/route';

const ENV = [
  'TALK_LIMIT_PARENT_PER_10_MIN',
  'TALK_LIMIT_PARENT_PER_DAY',
  'TALK_LIMIT_IP_PER_10_MIN',
  'TALK_LIMIT_IP_PER_DAY',
  'TALK_VOICE_MINUTES_PER_DAY',
];

beforeEach(() => {
  q = makeTestDb();
  delete process.env.AI_API_KEY;
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ENV) delete process.env[k];
});

async function readyParent(): Promise<{ parentId: string; token: string; conversationId: string }> {
  const { rows } = await q.query<{ id: string }>(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [
    `b${Math.random()}@example.com`,
  ]);
  const buyerId = rows[0].id;
  const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });
  await consentRepo.record(q, { parentId: parent.id, kind: 'buyer_attestation', grantedBy: buyerId });
  await parentRepo.activate(q, parent.id, buyerId);
  await consentRepo.record(q, { parentId: parent.id, kind: 'parent_conversation' });
  await q.query(
    `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, current_period_end)
     VALUES ($1, $2, 'family', 'trialing', now() + interval '7 days')`,
    [buyerId, parent.id],
  );
  const { token } = await accessTokenRepo.issue(q, parent.id);
  const convo = await conversationRepo.openSession(q, parent.id, 'text');
  return { parentId: parent.id, token, conversationId: convo.id };
}

function textReq(token: string, body: unknown, ip = '203.0.113.7'): NextRequest {
  return new NextRequest('http://localhost/api/talk/message', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

function voiceReq(token: string, conversationId: string, audio?: Blob): NextRequest {
  const form = new FormData();
  form.set('conversation_id', conversationId);
  form.set('audio', audio ?? new Blob([Buffer.from('fake-audio')], { type: 'audio/webm' }), 'clip.webm');
  return new NextRequest('http://localhost/api/talk/voice', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.7' },
    body: form,
  });
}

const say = (token: string, conversationId: string, content = 'Hello there', ip?: string) =>
  messagePOST(textReq(token, { conversation_id: conversationId, content }, ip));

describe('atomic rate limiter', () => {
  it('counts every concurrent hit exactly once and resets after the window', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => rateLimitRepo.hit(q, 'k', { limit: 5, windowMs: 60_000 })),
    );
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(results.filter((r) => r.allowed)).toHaveLength(5);

    // An expired window restarts at 1.
    await q.query(`UPDATE auth_rate_limit SET window_start = now() - interval '2 minutes' WHERE key = 'k'`);
    expect(await rateLimitRepo.hit(q, 'k', { limit: 5, windowMs: 60_000 })).toEqual({ allowed: true, count: 1 });
  });
});

describe('talk rate limits', () => {
  it('429s a parent after the per-10-minute limit, with a speakable message', async () => {
    process.env.TALK_LIMIT_PARENT_PER_10_MIN = '2';
    const { token, conversationId } = await readyParent();
    expect((await say(token, conversationId)).status).toBe(200);
    expect((await say(token, conversationId)).status).toBe(200);
    const res = await say(token, conversationId);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toEqual({ code: 'rate_limited', message: 'Let’s take a short break. Please try again in a few minutes.' });
  });

  it('limits per IP too, across different parents (a leaked link shared around)', async () => {
    process.env.TALK_LIMIT_IP_PER_10_MIN = '2';
    const a = await readyParent();
    const b = await readyParent();
    expect((await say(a.token, a.conversationId)).status).toBe(200);
    expect((await say(b.token, b.conversationId)).status).toBe(200);
    expect((await say(b.token, b.conversationId)).status).toBe(429);
    // A different IP is unaffected.
    expect((await say(b.token, b.conversationId, 'Hi', '198.51.100.9')).status).toBe(200);
  });

  it('the daily limit has its own message', async () => {
    process.env.TALK_LIMIT_PARENT_PER_DAY = '1';
    const { token, conversationId } = await readyParent();
    await say(token, conversationId);
    const body = await (await say(token, conversationId)).json();
    expect(body.error.message).toBe('We’ve talked a lot today. Let’s chat again tomorrow.');
  });

  it('opening a session counts against the limit (it costs a spoken greeting)', async () => {
    process.env.TALK_LIMIT_PARENT_PER_10_MIN = '1';
    const { token } = await readyParent();
    const open = () =>
      sessionPOST(new NextRequest('http://localhost/api/talk/session', { method: 'POST', headers: { authorization: `Bearer ${token}` } }));
    expect((await open()).status).toBe(201);
    expect((await open()).status).toBe(429);
  });

  it('caps daily voice time per parent; typing still works', async () => {
    process.env.TALK_VOICE_MINUTES_PER_DAY = '1';
    const { token, conversationId, parentId } = await readyParent();
    await usageCostRepo.recordSttCost(q, { turnId: null, conversationId, parentId, durationSeconds: 61 });
    const stt = vi.spyOn(fakeSpeechClient, 'speechToText');

    const res = await voicePOST(voiceReq(token, conversationId));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('voice_limit');
    expect(stt).not.toHaveBeenCalled();
    expect((await say(token, conversationId)).status).toBe(200);
    expect(mapTalkError({ status: 429, code: 'voice_limit' })).toMatchObject({ canType: true });
  });
});

describe('size caps', () => {
  it(`text over ${TEXT_MAX_CHARS} characters → 413 before any model call`, async () => {
    const { token, conversationId } = await readyParent();
    const reply = vi.spyOn(fakeAiClient, 'companionReply');
    expect((await say(token, conversationId, 'a'.repeat(TEXT_MAX_CHARS))).status).toBe(200);
    const res = await say(token, conversationId, 'a'.repeat(TEXT_MAX_CHARS + 1));
    expect(res.status).toBe(413);
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('audio over 3 MB → 413 before speech-to-text', async () => {
    const { token, conversationId } = await readyParent();
    const stt = vi.spyOn(fakeSpeechClient, 'speechToText');
    const big = new Blob([new Uint8Array(AUDIO_MAX_BYTES + 1)], { type: 'audio/webm' });
    const res = await voicePOST(voiceReq(token, conversationId, big));
    expect(res.status).toBe(413);
    expect(stt).not.toHaveBeenCalled();
  });

  it('the voice route never runs longer than 30 seconds', () => {
    expect(voiceMaxDuration).toBe(30);
  });

  it(`a conversation ends itself after ${MAX_PARENT_TURNS} parent turns`, async () => {
    const { token, conversationId, parentId } = await readyParent();
    for (let i = 0; i < MAX_PARENT_TURNS; i += 1) {
      await conversationRepo.addTurn(q, conversationId, parentId, 'parent', `turn ${i}`);
    }
    const res = await say(token, conversationId);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('conversation_full');
    const convo = await conversationRepo.getForParent(q, conversationId, parentId);
    expect(convo.ended_at).not.toBeNull();
    expect(mapTalkError({ status: 409, code: 'conversation_full' }).message).toMatch(/Talk again/);
  });
});

describe('history window', () => {
  it('trimHistory keeps the newest 20 turns, oldest first, within the token budget', () => {
    const turns = Array.from({ length: 50 }, (_, i) => ({ role: (i % 2 ? 'kindly' : 'parent') as 'parent' | 'kindly', content: `t${i}` }));
    const kept = trimHistory(turns);
    expect(kept).toHaveLength(20);
    expect(kept[0].content).toBe('t30');
    expect(kept[19].content).toBe('t49');

    const long = Array.from({ length: 10 }, (_, i) => ({ role: 'parent' as const, content: `${i}`.padEnd(2_000, 'x') }));
    const fit = trimHistory(long);
    expect(fit.length).toBeLessThan(10);
    expect(fit.at(-1)?.content.startsWith('9')).toBe(true);
    expect(fit.reduce((n, t) => n + Math.ceil(t.content.length / 4) + 4, 0)).toBeLessThanOrEqual(HISTORY_TOKEN_BUDGET);
  });

  it('a long conversation sends only the recent window to the model', async () => {
    const { token, conversationId, parentId } = await readyParent();
    for (let i = 0; i < 60; i += 1) {
      await conversationRepo.addTurn(q, conversationId, parentId, i % 2 ? 'kindly' : 'parent', `turn ${i}`);
    }
    const reply = vi.spyOn(fakeAiClient, 'companionReply');
    await say(token, conversationId);
    const sent = reply.mock.calls[0][0].history;
    expect(sent.length).toBeLessThanOrEqual(20);
    expect(sent.at(-1)?.content).toBe('turn 59');
  });
});

describe('LLM cost ledger', () => {
  const usage = (model: string, inputTokens: number, outputTokens: number) => ({ model, inputTokens, outputTokens });

  it('prices tokens per model (micros per token = $ per million tokens)', () => {
    expect(llmCostMicros('claude-sonnet-4-6', 1_000, 200)).toBe(3_000 + 3_000);
    expect(llmCostMicros('claude-haiku-4-5', 1_000, 100)).toBe(1_000 + 500);
    expect(llmRates('claude-haiku-4-5-20251001').known).toBe(true);
    expect(llmRates('some-new-model')).toMatchObject({ known: false, input: 5, output: 25 });
  });

  it('records a row per model call of a text turn (scan + reply), tied to the reply turn', async () => {
    const { token, conversationId, parentId } = await readyParent();
    vi.spyOn(fakeAiClient, 'safetyScan').mockResolvedValue({ severity: 'none', rationale: '', usage: usage('claude-haiku-4-5', 400, 20) });
    vi.spyOn(fakeAiClient, 'companionReply').mockResolvedValue({ text: 'How lovely.', usage: usage('claude-sonnet-4-6', 1_200, 30) });
    expect((await say(token, conversationId)).status).toBe(200);

    const { rows } = await q.query<{ operation: string; model: string; input_tokens: number; output_tokens: number; cost_micros: string; turn_id: string | null; unit: string }>(
      `SELECT operation, model, input_tokens, output_tokens, cost_micros, turn_id, unit FROM usage_costs
       WHERE parent_id = $1 AND provider = 'anthropic_llm' ORDER BY operation`,
      [parentId],
    );
    expect(rows.map((r) => [r.operation, r.model, r.input_tokens, r.output_tokens, Number(r.cost_micros), r.unit])).toEqual([
      ['reply', 'claude-sonnet-4-6', 1_200, 30, 3_600 + 450, 'token'],
      ['scan', 'claude-haiku-4-5', 400, 20, 400 + 100, 'token'],
    ]);
    expect(rows.every((r) => r.turn_id)).toBe(true);
  });

  it('records the regeneration call too', async () => {
    const { token, conversationId, parentId } = await readyParent();
    vi.spyOn(fakeAiClient, 'companionReply')
      .mockResolvedValueOnce({ text: "I'm a real person, just like you.", usage: usage('claude-sonnet-4-6', 100, 10) })
      .mockResolvedValueOnce({ text: 'I’m an AI companion. How was your day?', usage: usage('claude-sonnet-4-6', 120, 12) });
    await say(token, conversationId);
    const { rows } = await q.query<{ operation: string }>(
      `SELECT operation FROM usage_costs WHERE parent_id = $1 AND provider = 'anthropic_llm'`,
      [parentId],
    );
    expect(rows.map((r) => r.operation).sort()).toEqual(['regeneration', 'reply']);
  });

  it('records session-end summary and extraction costs without a turn', async () => {
    const { conversationId, parentId } = await readyParent();
    await conversationRepo.addTurn(q, conversationId, parentId, 'parent', 'I love gardening');
    await conversationRepo.end(q, conversationId, parentId);
    const ai = {
      ...fakeAiClient,
      summarizeConversation: async () => ({ summaryText: 'A gentle chat.', moodSignal: null, usage: usage('claude-sonnet-4-6', 800, 60) }),
      extractMemories: async () => ({ candidates: [], usage: usage('claude-sonnet-4-6', 700, 40) }),
    };
    await runSessionEndJobs(q, conversationId, { ai });
    const { rows } = await q.query<{ operation: string; turn_id: string | null }>(
      `SELECT operation, turn_id FROM usage_costs WHERE parent_id = $1 ORDER BY operation`,
      [parentId],
    );
    expect(rows).toEqual([
      { operation: 'extraction', turn_id: null },
      { operation: 'summary', turn_id: null },
    ]);
  });

  it('the fake client writes no LLM rows (demo usage never pollutes cost)', async () => {
    const { token, conversationId, parentId } = await readyParent();
    await say(token, conversationId);
    const { rows } = await q.query(`SELECT 1 FROM usage_costs WHERE parent_id = $1 AND provider = 'anthropic_llm'`, [parentId]);
    expect(rows).toHaveLength(0);
  });

  it('cost rows survive the 30-day transcript purge (turn_id becomes null)', async () => {
    const { conversationId, parentId } = await readyParent();
    const turn = await conversationRepo.addTurn(q, conversationId, parentId, 'kindly', 'hello');
    await usageCostRepo.recordLlmCost(q, { turnId: turn.id, conversationId, parentId, usage: usage('claude-sonnet-4-6', 10, 10), operation: 'reply' });
    await usageCostRepo.recordTtsCost(q, { turnId: turn.id, conversationId, parentId, characterCount: 5 });
    await q.query(`DELETE FROM conversation_turns WHERE id = $1`, [turn.id]);
    const { rows } = await q.query<{ turn_id: string | null }>(`SELECT turn_id FROM usage_costs WHERE parent_id = $1`, [parentId]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.turn_id === null)).toBe(true);
  });
});

describe('admin cost metrics', () => {
  it('a text-only conversation no longer shows $0; LLM, STT and TTS are split; top spenders are pseudonymous', async () => {
    const a = await readyParent();
    const b = await readyParent();
    const u = { model: 'claude-sonnet-4-6', inputTokens: 1_000, outputTokens: 100 };
    await usageCostRepo.recordLlmCost(q, { turnId: null, conversationId: a.conversationId, parentId: a.parentId, usage: u, operation: 'reply' });
    await usageCostRepo.recordLlmCost(q, { turnId: null, conversationId: b.conversationId, parentId: b.parentId, usage: u, operation: 'reply' });
    await usageCostRepo.recordSttCost(q, { turnId: null, conversationId: b.conversationId, parentId: b.parentId, durationSeconds: 60 });
    await usageCostRepo.recordTtsCost(q, { turnId: null, conversationId: b.conversationId, parentId: b.parentId, characterCount: 100 });

    const [bucket] = await adminMetricsRepo.costBuckets(q, 'week');
    expect(bucket.llm_cost_micros).toBe(2 * 4_500);
    expect(bucket.stt_cost_micros).toBeGreaterThan(0);
    expect(bucket.tts_cost_micros).toBe(10_000);
    expect(bucket.total_cost_micros).toBe(bucket.llm_cost_micros + bucket.stt_cost_micros + bucket.tts_cost_micros);
    expect(bucket.cost_per_active_user_micros).toBe(Math.round(bucket.total_cost_micros / 2));

    const top = await adminMetricsRepo.topSpenders(q);
    expect(top.map((t) => t.parent_ref)).toEqual([parentRef(b.parentId), parentRef(a.parentId)]);
    expect(top[1]).toMatchObject({ llm_cost_micros: 4_500, speech_cost_micros: 0, total_cost_micros: 4_500 });
    expect(JSON.stringify(top)).not.toContain(a.parentId);
    expect(top[0].parent_ref).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('admin money formatting', () => {
  it('shows sub-cent amounts with 4 decimals instead of $0.00', async () => {
    const { fmtDollars } = await import('../src/app/admin/CostRetentionPanel');
    expect(fmtDollars(3_700)).toBe('$0.0037');
    expect(fmtDollars(0)).toBe('$0.00');
    expect(fmtDollars(110_000)).toBe('$0.11');
  });
});
