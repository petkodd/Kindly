import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { consentRepo } from '../../src/lib/repos/consent';
import { conversationRepo } from '../../src/lib/repos/conversation';
import { accessTokenRepo } from '../../src/lib/repos/accessToken';
import { usageCostRepo } from '../../src/lib/repos/usageCost';
import { fakeSpeechClient } from '../../src/lib/speech/fake';
import { fakeAiClient } from '../../src/lib/ai/fake';
import { fakeEmailClient } from '../../src/lib/email/fake';
import { SAFE_FALLBACK_REPLY } from '../../src/lib/ai/outputFilter';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handler picks up the mocked db().
import { POST as voicePOST } from '../../src/app/api/talk/voice/route';

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

/** Activated parent with an open voice conversation, ready to exchange turns. */
async function makeOpenVoiceSession(): Promise<{ parentId: string; conversationId: string; token: string }> {
  const buyerId = await makeBuyer(`b${Math.random()}@example.com`);
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
  const convo = await conversationRepo.openSession(q, parent.id, 'voice');
  return { parentId: parent.id, conversationId: convo.id, token };
}

function voiceForm(conversationId: string, audio?: Blob): FormData {
  const form = new FormData();
  form.set('conversation_id', conversationId);
  form.set('audio', audio ?? new Blob([Buffer.from('fake-audio-bytes')], { type: 'audio/webm' }), 'clip.webm');
  return form;
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  q = makeTestDb();
  delete process.env.AI_API_KEY; // force the fake AI client
  delete process.env.DEEPGRAM_API_KEY; // force the fake speech client
  delete process.env.ELEVENLABS_API_KEY;
});

describe('POST /api/talk/voice', () => {
  it('401s without a valid parent access token', async () => {
    const req = new NextRequest('http://localhost/api/talk/voice', {
      method: 'POST',
      body: voiceForm('whatever'),
    });
    const res = await voicePOST(req);
    expect(res.status).toBe(401);
  });

  it('400s a non-multipart body', async () => {
    const { token } = await makeOpenVoiceSession();
    const req = new NextRequest('http://localhost/api/talk/voice', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ conversation_id: 'x' }),
    });
    const res = await voicePOST(req);
    expect(res.status).toBe(400);
  });

  it('400s a missing audio field', async () => {
    const { token, conversationId } = await makeOpenVoiceSession();
    const form = new FormData();
    form.set('conversation_id', conversationId);
    const req = new NextRequest('http://localhost/api/talk/voice', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    const res = await voicePOST(req);
    expect(res.status).toBe(400);
  });

  it('runs the STT -> reply -> TTS pipeline and persists both turns + voice minutes', async () => {
    const { token, conversationId, parentId } = await makeOpenVoiceSession();
    const req = new NextRequest('http://localhost/api/talk/voice', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: voiceForm(conversationId),
    });
    const res = await voicePOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversation_id).toBe(conversationId);
    expect(typeof body.transcript).toBe('string');
    expect(body.transcript.length).toBeGreaterThan(0);
    expect(typeof body.reply).toBe('string');
    expect(body.tts_url).toMatch(/^data:audio\//);

    const turns = await conversationRepo.listTurns(q, conversationId);
    expect(turns.map((t) => t.role)).toEqual(['parent', 'kindly']);

    const { rows } = await q.query<{ voice_minutes: string }>(
      `SELECT voice_minutes FROM conversations WHERE id = $1 AND parent_id = $2`,
      [conversationId, parentId],
    );
    expect(parseFloat(rows[0].voice_minutes)).toBeGreaterThan(0);

    // Both the STT and TTS calls get a real-time usage_costs row, FK'd to the
    // turn each one produced.
    const costRows = await q.query<{ turn_id: string; provider: string; cost_micros: string }>(
      `SELECT turn_id, provider, cost_micros FROM usage_costs
       WHERE conversation_id = $1 ORDER BY provider`,
      [conversationId],
    );
    expect(costRows.rows).toHaveLength(2);
    const [sttRow, ttsRow] = costRows.rows;
    expect(sttRow.provider).toBe('deepgram_stt');
    expect(sttRow.turn_id).toBe(turns[0].id);
    expect(Number(sttRow.cost_micros)).toBeGreaterThan(0);
    expect(ttsRow.provider).toBe('elevenlabs_tts');
    expect(ttsRow.turn_id).toBe(turns[1].id);
    expect(Number(ttsRow.cost_micros)).toBeGreaterThan(0);
  });

  it('still returns the transcript/reply/audio if writing usage_costs fails (cost accounting is auxiliary)', async () => {
    vi.spyOn(usageCostRepo, 'recordSttCost').mockRejectedValueOnce(new Error('boom'));
    const { token, conversationId } = await makeOpenVoiceSession();
    const req = new NextRequest('http://localhost/api/talk/voice', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: voiceForm(conversationId),
    });
    const res = await voicePOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.transcript).toBe('string');

    const turns = await conversationRepo.listTurns(q, conversationId);
    expect(turns.map((t) => t.role)).toEqual(['parent', 'kindly']);
  });

  it('404s a conversation that does not belong to the token\'s parent (isolation)', async () => {
    const { token } = await makeOpenVoiceSession();
    const { conversationId: otherConversationId } = await makeOpenVoiceSession();

    const req = new NextRequest('http://localhost/api/talk/voice', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: voiceForm(otherConversationId),
    });
    const res = await voicePOST(req);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/talk/voice — safety pipeline (same as text)', () => {
  async function sayOverVoice(transcript: string) {
    const session = await makeOpenVoiceSession();
    await q.query(
      `UPDATE users SET full_name = 'Sarah Miller' WHERE id = (SELECT buyer_id FROM parents WHERE id = $1)`,
      [session.parentId],
    );
    vi.spyOn(fakeSpeechClient, 'speechToText').mockResolvedValueOnce({ transcript, durationSeconds: 4 });
    const tts = vi.spyOn(fakeSpeechClient, 'textToSpeech');
    const req = new NextRequest('http://localhost/api/talk/voice', {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}` },
      body: voiceForm(session.conversationId),
    });
    const res = await voicePOST(req);
    expect(res.status).toBe(200);
    return { ...session, body: await res.json(), tts };
  }

  it('redacts a voice reply that claims to be a real person, and audit-logs it (case 13)', async () => {
    vi.spyOn(fakeAiClient, 'companionReply').mockResolvedValue({ text: "Of course, I'm a real person, just like you." });
    const { body, conversationId, tts } = await sayOverVoice('Are you a real person?');
    expect(body.reply).toBe(SAFE_FALLBACK_REPLY);
    // The redacted text is what gets spoken and stored, never the violation.
    expect(tts.mock.calls[0][0]).toBe(SAFE_FALLBACK_REPLY);
    const turns = await conversationRepo.listTurns(q, conversationId);
    expect(turns[turns.length - 1].content).toBe(SAFE_FALLBACK_REPLY);

    const { rows } = await q.query<{ action: string; meta: { violated: string[]; channel: string } }>(
      `SELECT action, meta FROM audit_log WHERE action LIKE 'banned_output_%'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('banned_output_redacted');
    expect(rows[0].meta.violated).toContain('humanClaim');
    expect(rows[0].meta.channel).toBe('voice');
  });

  it('prefixes a voice P0 with 988 and says honestly that the buyer is being told (case 14)', async () => {
    // Model a real email provider: only a real send counts as the family being notified.
    const send = vi.spyOn(fakeEmailClient, 'send').mockResolvedValue({ id: 'provider-email-1' });
    const { body, parentId, tts } = await sayOverVoice("I don't want to live anymore");
    expect(body.reply).toMatch(/988/);
    expect(body.reply).toMatch(/I'm going to let Sarah know so they can check on you/);
    expect(body.reply).not.toMatch(/I('ve| have)? (called|contacted)/i);
    expect(tts.mock.calls[0][0]).toMatch(/988/); // the parent hears it, not just reads it

    const { rows } = await q.query<{ severity: string; notified_at: Date | null; alert_email_status: string }>(
      `SELECT severity, notified_at, alert_email_status FROM safety_flags WHERE parent_id = $1`,
      [parentId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('p0_crisis');
    expect(rows[0].notified_at).not.toBeNull();
    expect(rows[0].alert_email_status).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('puts 911 in the first sentence for chest tightness and arm numbness over voice, flagged P1 (case 1)', async () => {
    const { body, parentId } = await sayOverVoice('My chest feels tight and my left arm is numb');
    const firstSentence = (body.reply as string).split(/(?<=[.!?])\s/)[0];
    expect(firstSentence).toMatch(/911/);
    const { rows } = await q.query<{ severity: string }>(`SELECT severity FROM safety_flags WHERE parent_id = $1`, [parentId]);
    expect(rows.map((r) => r.severity)).toEqual(['p1_acute_medical']);
  });
});
