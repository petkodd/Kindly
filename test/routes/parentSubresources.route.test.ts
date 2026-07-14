import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { memoryRepo } from '../../src/lib/repos/memory';
import { consentRepo } from '../../src/lib/repos/consent';
import { makeBuyer, authedReq as buyerReq } from './helpers';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { GET as memoriesGET, POST as memoriesPOST } from '../../src/app/api/parents/[id]/memories/route';
import { GET as recipientsGET } from '../../src/app/api/parents/[id]/recipients/route';
import { GET as summariesGET } from '../../src/app/api/parents/[id]/summaries/route';
import { GET as previewGET } from '../../src/app/api/parents/[id]/summary/preview/route';

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
});

describe('GET /api/parents/:id/memories', () => {
  it('404s reading memories for a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await memoriesGET(buyerReq(`http://localhost/api/parents/${parent.id}/memories`, attacker), { params: { id: parent.id } });
    expect(res.status).toBe(404);
  });

  it('lists memories, filterable by layer/status via query params', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    await memoryRepo.add(q, { parentId: parent.id, layer: 'core', key: 'hometown', value: 'Detroit', source: 'onboarding' });
    await memoryRepo.add(q, { parentId: parent.id, layer: 'interest', key: 'music', value: 'jazz', source: 'conversation' });

    const all = await memoriesGET(buyerReq(`http://localhost/api/parents/${parent.id}/memories`, buyer), { params: { id: parent.id } });
    expect((await all.json()).memories).toHaveLength(2);

    const filtered = await memoriesGET(
      buyerReq(`http://localhost/api/parents/${parent.id}/memories?layer=core`, buyer),
      { params: { id: parent.id } },
    );
    expect((await filtered.json()).memories).toHaveLength(1);
  });
});

describe('POST /api/parents/:id/memories', () => {
  it('404s adding a memory to a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await memoriesPOST(
      buyerReq(`http://localhost/api/parents/${parent.id}/memories`, attacker, {
        method: 'POST',
        body: JSON.stringify({ layer: 'core', key: 'hometown', value: 'Detroit' }),
      }),
      { params: { id: parent.id } },
    );
    expect(res.status).toBe(404);
  });

  it('adds a confirmed onboarding memory owned by the caller', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });

    const res = await memoriesPOST(
      buyerReq(`http://localhost/api/parents/${parent.id}/memories`, buyer, {
        method: 'POST',
        body: JSON.stringify({ layer: 'core', key: 'hometown', value: 'Detroit' }),
      }),
      { params: { id: parent.id } },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memory.status).toBe('confirmed');
  });
});

describe('GET /api/parents/:id/recipients', () => {
  it('404s for a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await recipientsGET(buyerReq(`http://localhost/api/parents/${parent.id}/recipients`, attacker), { params: { id: parent.id } });
    expect(res.status).toBe(404);
  });

  it('returns the safe recipient view without the invite token hash', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    await consentRepo.recordRecipientInvite(q, { parentId: parent.id, grantedBy: buyer, recipientEmail: 'sib@example.com' });

    const res = await recipientsGET(buyerReq(`http://localhost/api/parents/${parent.id}/recipients`, buyer), { params: { id: parent.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipients).toEqual([{ id: expect.any(String), email: 'sib@example.com', status: 'pending' }]);
  });
});

describe('GET /api/parents/:id/summaries', () => {
  it('404s for a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await summariesGET(buyerReq(`http://localhost/api/parents/${parent.id}/summaries`, attacker), { params: { id: parent.id } });
    expect(res.status).toBe(404);
  });

  it('returns an empty list before any summary exists', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });

    const res = await summariesGET(buyerReq(`http://localhost/api/parents/${parent.id}/summaries`, buyer), { params: { id: parent.id } });
    expect(res.status).toBe(200);
    expect((await res.json()).summaries).toEqual([]);
  });
});

describe('GET /api/parents/:id/summary/preview', () => {
  it('404s for a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await previewGET(buyerReq(`http://localhost/api/parents/${parent.id}/summary/preview`, attacker), { params: { id: parent.id } });
    expect(res.status).toBe(404);
  });

  it('generates the current-week preview using the parent\'s first name', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });

    const res = await previewGET(buyerReq(`http://localhost/api/parents/${parent.id}/summary/preview`, buyer), { params: { id: parent.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.status).toBe('preview');
    expect(body.summary.body_short).toContain('Robert');
  });
});
