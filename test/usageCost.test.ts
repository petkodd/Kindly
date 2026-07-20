import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { usageCostRepo } from '../src/lib/repos/usageCost';
import {
  DEEPGRAM_STT_MICROS_PER_SECOND,
  ELEVENLABS_TTS_MICROS_PER_CHARACTER,
} from '../src/lib/billing/usageRates';

let q: Querier;

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

/** Parent + conversation + one turn, ready to attach a usage_costs row to. */
async function makeFixtureTurn(): Promise<{ parentId: string; conversationId: string; turnId: string }> {
  const buyerId = await makeBuyer(`b${Math.random()}@example.com`);
  const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });
  const { rows: convRows } = await q.query<{ id: string }>(
    `INSERT INTO conversations (parent_id) VALUES ($1) RETURNING id`,
    [parent.id],
  );
  const conversationId = convRows[0].id;
  const { rows: turnRows } = await q.query<{ id: string }>(
    `INSERT INTO conversation_turns (conversation_id, role, content) VALUES ($1, 'parent', 'hello') RETURNING id`,
    [conversationId],
  );
  return { parentId: parent.id, conversationId, turnId: turnRows[0].id };
}

beforeEach(() => {
  q = makeTestDb();
});

describe('usageCostRepo.recordSttCost', () => {
  it('stores quantity/rate/cost so cost_micros == round(quantity * rate) exactly', async () => {
    const { parentId, conversationId, turnId } = await makeFixtureTurn();
    const durationSeconds = 12.34;

    const record = await usageCostRepo.recordSttCost(q, {
      turnId,
      conversationId,
      parentId,
      durationSeconds,
    });

    expect(record.provider).toBe('deepgram_stt');
    expect(record.unit).toBe('second');
    expect(Number(record.quantity)).toBeCloseTo(durationSeconds, 4);
    expect(Number(record.unit_rate_micros)).toBeCloseTo(DEEPGRAM_STT_MICROS_PER_SECOND, 4);
    expect(Number(record.cost_micros)).toBe(Math.round(durationSeconds * DEEPGRAM_STT_MICROS_PER_SECOND));
  });
});

describe('usageCostRepo.recordTtsCost', () => {
  it('stores quantity/rate/cost so cost_micros == round(quantity * rate) exactly', async () => {
    const { parentId, conversationId, turnId } = await makeFixtureTurn();
    const characterCount = 287;

    const record = await usageCostRepo.recordTtsCost(q, {
      turnId,
      conversationId,
      parentId,
      characterCount,
    });

    expect(record.provider).toBe('elevenlabs_tts');
    expect(record.unit).toBe('character');
    expect(Number(record.quantity)).toBe(characterCount);
    expect(Number(record.unit_rate_micros)).toBeCloseTo(ELEVENLABS_TTS_MICROS_PER_CHARACTER, 4);
    expect(Number(record.cost_micros)).toBe(Math.round(characterCount * ELEVENLABS_TTS_MICROS_PER_CHARACTER));
  });
});
