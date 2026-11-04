import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { consentRepo } from '../src/lib/repos/consent';
import { conversationRepo } from '../src/lib/repos/conversation';
import { accessTokenRepo } from '../src/lib/repos/accessToken';
import { usageCostRepo } from '../src/lib/repos/usageCost';
import { fakeAiClient } from '../src/lib/ai/fake';
import { fakeSpeechClient } from '../src/lib/speech/fake';
import { fakeEmailClient } from '../src/lib/email/fake';
import { SAFE_FALLBACK_REPLY } from '../src/lib/ai/prompts';
import { MAX_PARENT_TURNS, TEXT_MAX_CHARS } from '../src/lib/talk/limits';
import { REFUSED_TURN_FLAG_DETAIL } from '../src/lib/talk/crisisShortcut';

/**
 * Release check NEW-2 (B3): crisis words get 988/911 help, a safety flag and a
 * family alert on every path, including turns the talk routes refuse (rate
 * limit, size cap, voice-minute cap, full conversation) and turns whose reply
 * or speech fails.
 */

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

import { POST as messagePOST } from '../src/app/api/talk/message/route';
import { POST as voicePOST, CRISIS_STT_LIMIT } from '../src/app/api/talk/voice/route';

const BUYER = 'sarah@example.com';

beforeEach(() => {
  q = makeTestDb();
  delete process.env.AI_API_KEY;
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  process.env.ADMIN_ALERT_EMAIL = 'safety-team@example.com';
  // A real provider: only a real send counts as the family being told.
  vi.spyOn(fakeEmailClient, 'send').mockResolvedValue({ id: 'provider-email-1' });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_ALERT_EMAIL;
  delete process.env.TALK_LIMIT_PARENT_PER_10_MIN;
  delete process.env.TALK_VOICE_MINUTES_PER_DAY;
});

async function readyParent() {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email, full_name) VALUES ($1, 'Sarah Miller') RETURNING id`,
    [BUYER],
  );
  const buyerId = rows[0].id;
  const parent = await parentRepo.create(q, { buyerId, firstName: 'Ruth', relationship: 'mother' });
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

const say = (token: string, conversationId: string, content: string) =>
  messagePOST(
    new NextRequest('http://localhost/api/talk/message', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ conversation_id: conversationId, content }),
    }),
  );

const speak = (token: string, conversationId: string) => {
  const form = new FormData();
  form.set('conversation_id', conversationId);
  form.set('audio', new Blob([Buffer.from('fake-audio')], { type: 'audio/webm' }), 'clip.webm');
  return voicePOST(
    new NextRequest('http://localhost/api/talk/voice', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.7' },
      body: form,
    }),
  );
};

const flags = async (parentId: string) =>
  (
    await q.query<{ severity: string; conversation_id: string | null; detail: string; notified_at: string | null }>(
      `SELECT severity, conversation_id, detail, notified_at FROM safety_flags WHERE parent_id = $1`,
      [parentId],
    )
  ).rows;

const familyEmails = () =>
  vi.mocked(fakeEmailClient.send).mock.calls.filter((c) => (c[0] as { to: string }).to === BUYER).length;

async function rateLimit(token: string, conversationId: string) {
  process.env.TALK_LIMIT_PARENT_PER_10_MIN = '1';
  expect((await say(token, conversationId, 'Hello there')).status).toBe(200);
  expect((await say(token, conversationId, 'Hello again')).status).toBe(429);
}

describe('text route: crisis words on a refused turn', () => {
  it('rate-limited "I want to kill myself" → 988 crisis copy, a P0 flag and a family alert (not "take a short break")', async () => {
    const { parentId, token, conversationId } = await readyParent();
    await rateLimit(token, conversationId);

    const res = await say(token, conversationId, 'I want to kill myself');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.crisis).toBe('p0');
    expect(body.reply).toMatch(/988/);
    expect(body.reply).toMatch(/I'm going to let Sarah know/);
    expect(body.reply).not.toMatch(/short break/);
    expect(body.tts_url).toMatch(/^data:audio/);

    const [flag] = await flags(parentId);
    expect(flag).toMatchObject({ severity: 'p0_crisis', conversation_id: conversationId, detail: REFUSED_TURN_FLAG_DETAIL });
    expect(flag.notified_at).not.toBeNull();
    expect(familyEmails()).toBe(1);
  });

  it('rate-limited ordinary message still gets the 429, with no flag', async () => {
    const { parentId, token, conversationId } = await readyParent();
    await rateLimit(token, conversationId);
    const res = await say(token, conversationId, 'Tell me about the weather');
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toMatch(/988/);
    expect(await flags(parentId)).toHaveLength(0);
  });

  it('over-length text is checked on its first 2000 characters', async () => {
    const { parentId, token, conversationId } = await readyParent();
    const early = 'I have chest pain. ' + 'a'.repeat(TEXT_MAX_CHARS);
    const res = await say(token, conversationId, early);
    expect(res.status).toBe(200);
    expect((await res.json()).reply).toMatch(/Please call 911 right now/);
    expect((await flags(parentId))[0].severity).toBe('p1_acute_medical');

    const late = 'a'.repeat(TEXT_MAX_CHARS) + ' I have chest pain';
    expect((await say(token, conversationId, late)).status).toBe(413);
    expect(await flags(parentId)).toHaveLength(1);
  });

  it('a full conversation still answers crisis words', async () => {
    const { parentId, token, conversationId } = await readyParent();
    for (let i = 0; i < MAX_PARENT_TURNS; i += 1) {
      await conversationRepo.addTurn(q, conversationId, parentId, 'parent', `turn ${i}`);
    }
    const res = await say(token, conversationId, 'I fell down and I can’t get up');
    expect(res.status).toBe(200);
    expect((await res.json()).reply).toMatch(/911/);
    expect((await flags(parentId))[0].severity).toBe('p1_acute_medical');
  });

  it('a crisis turn whose reply fails returns crisis copy + safe fallback, not an error', async () => {
    const { parentId, token, conversationId } = await readyParent();
    vi.spyOn(fakeAiClient, 'companionReply').mockRejectedValue(new Error('model down'));
    const res = await say(token, conversationId, "I don't want to live anymore");
    expect(res.status).toBe(200);
    const { reply } = await res.json();
    expect(reply).toMatch(/988/);
    expect(reply.endsWith(SAFE_FALLBACK_REPLY)).toBe(true);
    expect(await flags(parentId)).toHaveLength(1);
    expect(familyEmails()).toBe(1);
  });

  it('when the family alert fails, the crisis copy does not claim the family is being told', async () => {
    const { token, conversationId } = await readyParent();
    await rateLimit(token, conversationId);
    vi.mocked(fakeEmailClient.send).mockImplementation(async (input) => {
      if ((input as { to: string }).to === BUYER) throw new Error('provider down');
      return { id: 'ok' };
    });
    const { reply } = await (await say(token, conversationId, 'I want to kill myself')).json();
    expect(reply).toMatch(/988/);
    expect(reply).not.toMatch(/let .* know/);
  });
});

describe('voice route: crisis words on a refused or failed turn', () => {
  it('rate-limited voice turn with crisis words → crisis copy with the transcript and a flag', async () => {
    const { parentId, token, conversationId } = await readyParent();
    await rateLimit(token, conversationId);
    vi.spyOn(fakeSpeechClient, 'speechToText').mockResolvedValue({ transcript: 'I want to kill myself', durationSeconds: 2 });

    const res = await speak(token, conversationId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ transcript: 'I want to kill myself', crisis: 'p0' });
    expect(body.reply).toMatch(/988/);
    expect(body.tts_url).toMatch(/^data:audio/);
    expect((await flags(parentId))[0].severity).toBe('p0_crisis');
  });

  it('voice-minute cap: crisis words still get help; ordinary words get the voice_limit refusal', async () => {
    process.env.TALK_VOICE_MINUTES_PER_DAY = '1';
    const { parentId, token, conversationId } = await readyParent();
    await usageCostRepo.recordSttCost(q, { turnId: null, conversationId, parentId, durationSeconds: 61 });

    const ordinary = await speak(token, conversationId);
    expect(ordinary.status).toBe(429);
    expect((await ordinary.json()).error.code).toBe('voice_limit');

    vi.spyOn(fakeSpeechClient, 'speechToText').mockResolvedValue({ transcript: 'my chest feels tight', durationSeconds: 2 });
    const crisis = await speak(token, conversationId);
    expect(crisis.status).toBe(200);
    expect((await crisis.json()).reply).toMatch(/Please call 911 right now/);
    expect(await flags(parentId)).toHaveLength(1);
  });

  it(`refused clips are transcribed at most ${CRISIS_STT_LIMIT.limit} times a day per parent (spend guard)`, async () => {
    const { token, conversationId } = await readyParent();
    await rateLimit(token, conversationId);
    const stt = vi.spyOn(fakeSpeechClient, 'speechToText');
    for (let i = 0; i < CRISIS_STT_LIMIT.limit + 2; i += 1) {
      expect((await speak(token, conversationId)).status).toBe(429);
    }
    expect(stt).toHaveBeenCalledTimes(CRISIS_STT_LIMIT.limit);
  });

  it('a TTS failure after the reply still saves the turns and returns the text with tts_url null', async () => {
    const { parentId, token, conversationId } = await readyParent();
    vi.spyOn(fakeSpeechClient, 'speechToText').mockResolvedValue({ transcript: 'I have chest pain', durationSeconds: 2 });
    vi.spyOn(fakeSpeechClient, 'textToSpeech').mockRejectedValue(new Error('tts down'));

    const res = await speak(token, conversationId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tts_url).toBeNull();
    expect(body.reply).toMatch(/Please call 911 right now/);
    const turns = await conversationRepo.listRecentTurns(q, conversationId, 10);
    expect(turns.map((t) => t.role)).toEqual(['parent', 'kindly']);
    expect((await flags(parentId))[0].severity).toBe('p1_acute_medical');
    // No TTS cost row for audio that was never made.
    const tts = await q.query(`SELECT 1 FROM usage_costs WHERE parent_id = $1 AND provider = 'elevenlabs_tts'`, [parentId]);
    expect(tts.rows).toHaveLength(0);
  });
});
