import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { consentRepo } from '../src/lib/repos/consent';
import { conversationRepo } from '../src/lib/repos/conversation';
import { fakeSpeechClient } from '../src/lib/speech/fake';
import { NotFoundError } from '../src/lib/types';

let q: Querier;

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function makeConsentedParent(): Promise<{ parentId: string; conversationId: string }> {
  const buyer = await makeBuyer(`b${Math.random()}@example.com`);
  const parent = await parentRepo.create(q, {
    buyerId: buyer,
    firstName: 'Robert',
    relationship: 'father',
  });
  await consentRepo.record(q, { parentId: parent.id, kind: 'buyer_attestation', grantedBy: buyer });
  await parentRepo.activate(q, parent.id, buyer);
  await consentRepo.record(q, { parentId: parent.id, kind: 'parent_conversation' });
  const convo = await conversationRepo.openSession(q, parent.id, 'voice');
  return { parentId: parent.id, conversationId: convo.id };
}

beforeEach(() => {
  q = makeTestDb();
});

describe('fakeSpeechClient', () => {
  it('returns a canned transcript with a positive duration', async () => {
    const audio = Buffer.from('fake-audio-bytes');
    const result = await fakeSpeechClient.speechToText(audio, 'audio/webm');
    expect(result.transcript).toBeTruthy();
    expect(result.durationSeconds).toBeGreaterThan(0);
  });

  it('returns a data URL for any text', async () => {
    const result = await fakeSpeechClient.textToSpeech('Hello there.');
    expect(result.audioUrl).toMatch(/^data:audio\/mp3;base64,/);
  });
});

describe('conversationRepo.addVoiceMinutes', () => {
  it('accumulates voice_minutes from durationSeconds', async () => {
    const { parentId, conversationId } = await makeConsentedParent();

    await conversationRepo.addVoiceMinutes(q, conversationId, parentId, 90); // 1.5 min
    await conversationRepo.addVoiceMinutes(q, conversationId, parentId, 30); // +0.5 min

    const { rows } = await q.query<{ voice_minutes: string }>(
      `SELECT voice_minutes FROM conversations WHERE id = $1`,
      [conversationId],
    );
    expect(parseFloat(rows[0].voice_minutes)).toBeCloseTo(2.0, 5);
  });

  it('rejects cross-parent access', async () => {
    const { conversationId } = await makeConsentedParent();
    const { parentId: otherId } = await makeConsentedParent();

    await expect(
      conversationRepo.addVoiceMinutes(q, conversationId, otherId, 60),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
