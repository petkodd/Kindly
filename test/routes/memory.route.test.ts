import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { memoryRepo } from '../../src/lib/repos/memory';
import { makeBuyer, authedReq as buyerReq } from './helpers';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { PATCH as memoryPATCH, DELETE as memoryDELETE } from '../../src/app/api/memories/[mid]/route';

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
});

describe('PATCH /api/memories/:mid', () => {
  it('401s without a buyer session', async () => {
    const res = await memoryPATCH(
      buyerReq('http://localhost/api/memories/x', null, { method: 'PATCH', body: JSON.stringify({ action: 'confirm' }) }),
      { params: { mid: 'x' } },
    );
    expect(res.status).toBe(401);
  });

  it('404s a memory owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const memory = await memoryRepo.add(q, { parentId: parent.id, layer: 'interest', key: 'music', value: 'jazz', source: 'conversation' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await memoryPATCH(
      buyerReq(`http://localhost/api/memories/${memory.id}`, attacker, { method: 'PATCH', body: JSON.stringify({ action: 'confirm' }) }),
      { params: { mid: memory.id } },
    );
    expect(res.status).toBe(404);
  });

  it('confirms a proposed memory', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const memory = await memoryRepo.add(q, { parentId: parent.id, layer: 'interest', key: 'music', value: 'jazz', source: 'conversation' });

    const res = await memoryPATCH(
      buyerReq(`http://localhost/api/memories/${memory.id}`, buyer, { method: 'PATCH', body: JSON.stringify({ action: 'confirm' }) }),
      { params: { mid: memory.id } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).memory.status).toBe('confirmed');
  });

  it('retires a memory (204, no body)', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const memory = await memoryRepo.add(q, { parentId: parent.id, layer: 'core', key: 'hometown', value: 'Detroit', source: 'onboarding' });

    const res = await memoryPATCH(
      buyerReq(`http://localhost/api/memories/${memory.id}`, buyer, { method: 'PATCH', body: JSON.stringify({ action: 'retire' }) }),
      { params: { mid: memory.id } },
    );
    expect(res.status).toBe(204);
    const [still] = await memoryRepo.list(q, parent.id, { status: 'retired' });
    expect(still?.id).toBe(memory.id);
  });

  it('400s an unknown action', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const memory = await memoryRepo.add(q, { parentId: parent.id, layer: 'core', key: 'hometown', value: 'Detroit', source: 'onboarding' });

    const res = await memoryPATCH(
      buyerReq(`http://localhost/api/memories/${memory.id}`, buyer, { method: 'PATCH', body: JSON.stringify({ action: 'nonsense' }) }),
      { params: { mid: memory.id } },
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/memories/:mid', () => {
  it('401s without a buyer session', async () => {
    const res = await memoryDELETE(buyerReq('http://localhost/api/memories/x', null, { method: 'DELETE' }), { params: { mid: 'x' } });
    expect(res.status).toBe(401);
  });

  it('404s a memory owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const memory = await memoryRepo.add(q, { parentId: parent.id, layer: 'core', key: 'pet', value: 'Buddy', source: 'onboarding' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await memoryDELETE(buyerReq(`http://localhost/api/memories/${memory.id}`, attacker, { method: 'DELETE' }), { params: { mid: memory.id } });
    expect(res.status).toBe(404);
  });

  it('hard-deletes an owned memory', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const memory = await memoryRepo.add(q, { parentId: parent.id, layer: 'core', key: 'pet', value: 'Buddy', source: 'onboarding' });

    const res = await memoryDELETE(buyerReq(`http://localhost/api/memories/${memory.id}`, buyer, { method: 'DELETE' }), { params: { mid: memory.id } });
    expect(res.status).toBe(204);
    expect((await memoryRepo.list(q, parent.id)).find((m) => m.id === memory.id)).toBeUndefined();
  });
});
