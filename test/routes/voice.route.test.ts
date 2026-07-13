import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { consentRepo } from '../../src/lib/repos/consent';
import { conversationRepo } from '../../src/lib/repos/conversation';
import { accessTokenRepo } from '../../src/lib/repos/accessToken';

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
