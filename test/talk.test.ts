import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { consentRepo } from '../src/lib/repos/consent';
import { memoryRepo } from '../src/lib/repos/memory';
import { accessTokenRepo } from '../src/lib/repos/accessToken';
import { conversationRepo } from '../src/lib/repos/conversation';
import { fakeAiClient } from '../src/lib/ai/fake';
import { ForbiddenError, NotFoundError, PreconditionError, ValidationError } from '../src/lib/types';

let q: Querier;

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function makeParent(
  consented: boolean,
  opts: { activate?: boolean } = {},
): Promise<string> {
  const buyer = await makeBuyer(`b${Math.random()}@example.com`);
  const parent = await parentRepo.create(q, {
    buyerId: buyer,
    firstName: 'Robert',
    relationship: 'father',
  });
  if (opts.activate !== false) {
    await consentRepo.record(q, { parentId: parent.id, kind: 'buyer_attestation', grantedBy: buyer });
    await parentRepo.activate(q, parent.id, buyer);
  }
  if (consented) {
    await consentRepo.record(q, { parentId: parent.id, kind: 'parent_conversation' });
  }
  return parent.id;
}

beforeEach(() => {
  q = makeTestDb();
});

describe('parent access tokens', () => {
  it('issues a raw token once and resolves it back to the parent', async () => {
    const parentId = await makeParent(false);
    const { token } = await accessTokenRepo.issue(q, parentId);
    expect(token).toMatch(/[A-Za-z0-9_-]+/);
    expect(await accessTokenRepo.resolveParentId(q, token)).toBe(parentId);
  });

  it('stores only a hash, never the raw token', async () => {
    const parentId = await makeParent(false);
    const { token } = await accessTokenRepo.issue(q, parentId);
    const { rows } = await q.query<{ token_hash: string }>(
      `SELECT token_hash FROM parent_access_tokens WHERE parent_id = $1`,
      [parentId],
    );
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toHaveLength(64); // sha256 hex
  });

  it('re-issuing revokes the previous token (single active link)', async () => {
    const parentId = await makeParent(false);
    const first = await accessTokenRepo.issue(q, parentId);
    const second = await accessTokenRepo.issue(q, parentId);
    await expect(accessTokenRepo.resolveParentId(q, first.token)).rejects.toBeInstanceOf(NotFoundError);
    expect(await accessTokenRepo.resolveParentId(q, second.token)).toBe(parentId);
  });

  it('rejects revoked, expired, and unknown tokens (NotFound, no oracle)', async () => {
    const parentId = await makeParent(false);
    const { token } = await accessTokenRepo.issue(q, parentId);
    await accessTokenRepo.revokeAll(q, parentId);
    await expect(accessTokenRepo.resolveParentId(q, token)).rejects.toBeInstanceOf(NotFoundError);

    const expired = await accessTokenRepo.issue(q, parentId, {
      expiresAt: '2000-01-01T00:00:00Z',
    });
    await expect(accessTokenRepo.resolveParentId(q, expired.token)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    await expect(accessTokenRepo.resolveParentId(q, 'not-a-real-token')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('defaults to a 90-day expiry when none is given — a leaked link doesn\'t stay valid forever', async () => {
    const parentId = await makeParent(false);
    await accessTokenRepo.issue(q, parentId);
    const { rows } = await q.query<{ expires_at: string | null }>(
      `SELECT expires_at FROM parent_access_tokens WHERE parent_id = $1`,
      [parentId],
    );
    expect(rows[0].expires_at).not.toBeNull();
    const days = (new Date(rows[0].expires_at!).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
  });

  it('passing expiresAt: null explicitly opts out of the default (never expires)', async () => {
    const parentId = await makeParent(false);
    await accessTokenRepo.issue(q, parentId, { expiresAt: null });
    const { rows } = await q.query<{ expires_at: string | null }>(
      `SELECT expires_at FROM parent_access_tokens WHERE parent_id = $1`,
      [parentId],
    );
    expect(rows[0].expires_at).toBeNull();
  });
});

describe('consent idempotency', () => {
  it('recording parent_conversation twice returns the same consent, not a duplicate', async () => {
    const parentId = await makeParent(false);
    const c1 = await consentRepo.ensure(q, { parentId, kind: 'parent_conversation' });
    const c2 = await consentRepo.ensure(q, { parentId, kind: 'parent_conversation' });
    expect(c2.id).toBe(c1.id);
    expect(await consentRepo.list(q, parentId, 'parent_conversation')).toHaveLength(1);
  });
});

describe('conversation consent gate + lifecycle', () => {
  it('BLOCKS opening a session for an un-activated parent (403)', async () => {
    const parentId = await makeParent(true, { activate: false });
    await expect(conversationRepo.openSession(q, parentId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('BLOCKS opening a session without parent_conversation consent (403)', async () => {
    const parentId = await makeParent(false);
    await expect(conversationRepo.openSession(q, parentId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('opens a session once consent is recorded', async () => {
    const parentId = await makeParent(true);
    const convo = await conversationRepo.openSession(q, parentId, 'text');
    expect(convo.parent_id).toBe(parentId);
    expect(convo.ended_at).toBeNull();
  });

  it('ISOLATION: a parent cannot add a turn to another parent\'s conversation', async () => {
    const alice = await makeParent(true);
    const mallory = await makeParent(true);
    const convo = await conversationRepo.openSession(q, alice);
    await expect(
      conversationRepo.addTurn(q, convo.id, mallory, 'parent', 'hi'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects empty turns and turns on an ended conversation', async () => {
    const parentId = await makeParent(true);
    const convo = await conversationRepo.openSession(q, parentId);
    await expect(
      conversationRepo.addTurn(q, convo.id, parentId, 'parent', '   '),
    ).rejects.toBeInstanceOf(ValidationError);

    await conversationRepo.end(q, convo.id, parentId);
    await expect(
      conversationRepo.addTurn(q, convo.id, parentId, 'parent', 'still there?'),
    ).rejects.toBeInstanceOf(PreconditionError);
  });

  it('end is idempotent', async () => {
    const parentId = await makeParent(true);
    const convo = await conversationRepo.openSession(q, parentId);
    const first = await conversationRepo.end(q, convo.id, parentId);
    const again = await conversationRepo.end(q, convo.id, parentId);
    expect(first.ended_at).not.toBeNull();
    expect(again.ended_at).toEqual(first.ended_at);
  });
});

describe('companion memory retrieval', () => {
  it('returns confirmed non-restricted memories only', async () => {
    const parentId = await makeParent(true);
    await memoryRepo.add(q, { parentId, layer: 'core', key: 'hometown', value: 'Detroit', source: 'onboarding' });
    await memoryRepo.add(q, {
      parentId, layer: 'sensitive', key: 'mood', value: 'felt low',
      source: 'conversation', sensitivity: 'restricted',
    });
    await memoryRepo.add(q, { parentId, layer: 'interest', key: 'food', value: 'pie', source: 'conversation' }); // proposed

    const memories = await memoryRepo.retrieveForCompanion(q, parentId);
    const keys = memories.map((m) => m.mem_key);
    expect(keys).toContain('hometown');
    expect(keys).not.toContain('mood'); // restricted
    expect(keys).not.toContain('food'); // unconfirmed
  });
});

describe('full talk turn flow (via fake client)', () => {
  it('records both turns and injects a memory into the reply', async () => {
    const parentId = await makeParent(true);
    await memoryRepo.add(q, {
      parentId, layer: 'interest', key: 'likes', value: 'gardening', source: 'onboarding',
    });
    const parent = await parentRepo.getById(q, parentId);
    const convo = await conversationRepo.openSession(q, parentId);

    // Mirror what /api/talk/message does.
    await conversationRepo.addTurn(q, convo.id, parentId, 'parent', 'Hello Kindly');
    const memories = (await memoryRepo.retrieveForCompanion(q, parentId)).map((m) => ({
      layer: m.layer,
      key: m.mem_key,
      value: m.mem_value,
    }));
    const reply = await fakeAiClient.companionReply({
      profile: { firstName: parent.first_name },
      memories,
      history: [],
      message: 'Hello Kindly',
      isSessionOpen: false,
    });
    await conversationRepo.addTurn(q, convo.id, parentId, 'kindly', reply.text);

    expect(reply.text).toContain('gardening');
    const turns = await conversationRepo.listTurns(q, convo.id);
    expect(turns.map((t) => t.role)).toEqual(['parent', 'kindly']);
  });
});
