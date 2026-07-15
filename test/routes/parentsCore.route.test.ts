import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { consentRepo } from '../../src/lib/repos/consent';
import { accessTokenRepo } from '../../src/lib/repos/accessToken';
import { makeBuyer, authedReq as buyerReq } from './helpers';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { GET as parentsGET, POST as parentsPOST } from '../../src/app/api/parents/route';
import { GET as parentGET, PATCH as parentPATCH, DELETE as parentDELETE } from '../../src/app/api/parents/[id]/route';
import { POST as activatePOST } from '../../src/app/api/parents/[id]/activate/route';
import { POST as accessLinkPOST } from '../../src/app/api/parents/[id]/access-link/route';
import { POST as accessLinkRevokePOST } from '../../src/app/api/parents/[id]/access-link/revoke/route';

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
  process.env.DATABASE_URL = 'postgres://test';
});

describe('GET /api/parents', () => {
  it('401s without a buyer session', async () => {
    const res = await parentsGET(buyerReq('http://localhost/api/parents', null));
    expect(res.status).toBe(401);
  });

  it('lists only the signed-in buyer\'s parents', async () => {
    const sarah = await makeBuyer(q, 'sarah@example.com');
    const mallory = await makeBuyer(q, 'mallory@example.com');
    await parentRepo.create(q, { buyerId: sarah, firstName: 'Robert', relationship: 'father' });
    await parentRepo.create(q, { buyerId: mallory, firstName: 'Eve', relationship: 'other' });

    const res = await parentsGET(buyerReq('http://localhost/api/parents', sarah));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parents).toHaveLength(1);
    expect(body.parents[0].first_name).toBe('Robert');
  });
});

describe('POST /api/parents', () => {
  it('401s without a buyer session', async () => {
    const res = await parentsPOST(
      buyerReq('http://localhost/api/parents', null, { method: 'POST', body: JSON.stringify({ first_name: 'Robert', relationship: 'father' }) }),
    );
    expect(res.status).toBe(401);
  });

  it('creates a parent profile owned by the caller', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const res = await parentsPOST(
      buyerReq('http://localhost/api/parents', buyer, {
        method: 'POST',
        body: JSON.stringify({ first_name: 'Robert', relationship: 'father' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.parent.first_name).toBe('Robert');
    expect(body.parent.activated_at).toBeNull();
  });

  it('400s an invalid relationship', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const res = await parentsPOST(
      buyerReq('http://localhost/api/parents', buyer, {
        method: 'POST',
        body: JSON.stringify({ first_name: 'Robert', relationship: 'cousin' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/parents/:id', () => {
  it('404s a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await parentGET(buyerReq(`http://localhost/api/parents/${parent.id}`, attacker), { params: { id: parent.id } });
    expect(res.status).toBe(404);
  });

  it('returns the owned parent', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });

    const res = await parentGET(buyerReq(`http://localhost/api/parents/${parent.id}`, buyer), { params: { id: parent.id } });
    expect(res.status).toBe(200);
    expect((await res.json()).parent.id).toBe(parent.id);
  });
});

describe('PATCH /api/parents/:id', () => {
  it('404s updating a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await parentPATCH(
      buyerReq(`http://localhost/api/parents/${parent.id}`, attacker, { method: 'PATCH', body: JSON.stringify({ city: 'Detroit' }) }),
      { params: { id: parent.id } },
    );
    expect(res.status).toBe(404);
  });

  it('updates accessibility/profile fields', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });

    const res = await parentPATCH(
      buyerReq(`http://localhost/api/parents/${parent.id}`, buyer, { method: 'PATCH', body: JSON.stringify({ city: 'Detroit', speech_rate: 'slow' }) }),
      { params: { id: parent.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parent.city).toBe('Detroit');
  });
});

describe('DELETE /api/parents/:id', () => {
  it('404s deleting a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await parentDELETE(buyerReq(`http://localhost/api/parents/${parent.id}`, attacker, { method: 'DELETE' }), { params: { id: parent.id } });
    expect(res.status).toBe(404);
  });

  it('soft-deletes the owned parent', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });

    const res = await parentDELETE(buyerReq(`http://localhost/api/parents/${parent.id}`, buyer, { method: 'DELETE' }), { params: { id: parent.id } });
    expect(res.status).toBe(202);
    expect(await parentRepo.listForBuyer(q, buyer)).toHaveLength(0);
  });
});

describe('POST /api/parents/:id/activate', () => {
  it('404s activating a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await activatePOST(buyerReq(`http://localhost/api/parents/${parent.id}/activate`, attacker, { method: 'POST' }), { params: { id: parent.id } });
    expect(res.status).toBe(404);
  });

  it('409s activation without buyer attestation', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });

    const res = await activatePOST(buyerReq(`http://localhost/api/parents/${parent.id}/activate`, buyer, { method: 'POST' }), { params: { id: parent.id } });
    expect(res.status).toBe(409);
  });

  it('activates once attestation is recorded', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    await consentRepo.record(q, { parentId: parent.id, kind: 'buyer_attestation', grantedBy: buyer });

    const res = await activatePOST(buyerReq(`http://localhost/api/parents/${parent.id}/activate`, buyer, { method: 'POST' }), { params: { id: parent.id } });
    expect(res.status).toBe(200);
    expect((await res.json()).parent.activated_at).toBeTruthy();
  });
});

describe('POST /api/parents/:id/access-link', () => {
  it('404s issuing a link for a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await accessLinkPOST(buyerReq(`http://localhost/api/parents/${parent.id}/access-link`, attacker, { method: 'POST' }), { params: { id: parent.id } });
    expect(res.status).toBe(404);
  });

  it('issues a raw talk token that resolves to the parent', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });

    const res = await accessLinkPOST(buyerReq(`http://localhost/api/parents/${parent.id}/access-link`, buyer, { method: 'POST' }), { params: { id: parent.id } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(await accessTokenRepo.resolveParentId(q, body.token)).toBe(parent.id);
  });

  it('by default revokes a prior token when issuing a new one', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const first = await accessTokenRepo.issue(q, parent.id);

    await accessLinkPOST(buyerReq(`http://localhost/api/parents/${parent.id}/access-link`, buyer, { method: 'POST' }), { params: { id: parent.id } });

    await expect(accessTokenRepo.resolveParentId(q, first.token)).rejects.toThrow();
  });

  it('keep_existing: true leaves a prior token (e.g. another device) valid (self-use re-entry)', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Maria', relationship: 'self' });
    const first = await accessTokenRepo.issue(q, parent.id);

    const res = await accessLinkPOST(
      buyerReq(`http://localhost/api/parents/${parent.id}/access-link`, buyer, {
        method: 'POST',
        body: JSON.stringify({ keep_existing: true }),
      }),
      { params: { id: parent.id } },
    );
    expect(res.status).toBe(201);

    expect(await accessTokenRepo.resolveParentId(q, first.token)).toBe(parent.id); // still valid
  });

  it('ignores keep_existing for a gift (non-self) parent — reissue always revokes the prior link', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const first = await accessTokenRepo.issue(q, parent.id);

    const res = await accessLinkPOST(
      buyerReq(`http://localhost/api/parents/${parent.id}/access-link`, buyer, {
        method: 'POST',
        body: JSON.stringify({ keep_existing: true }),
      }),
      { params: { id: parent.id } },
    );
    expect(res.status).toBe(201);

    await expect(accessTokenRepo.resolveParentId(q, first.token)).rejects.toThrow();
  });
});

describe('POST /api/parents/:id/access-link/revoke', () => {
  it('404s revoking a link for a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await accessLinkRevokePOST(buyerReq(`http://localhost/api/parents/${parent.id}/access-link/revoke`, attacker, { method: 'POST' }), { params: { id: parent.id } });
    expect(res.status).toBe(404);
  });

  it('revokes the active token so it no longer resolves', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token } = await accessTokenRepo.issue(q, parent.id);

    const res = await accessLinkRevokePOST(buyerReq(`http://localhost/api/parents/${parent.id}/access-link/revoke`, buyer, { method: 'POST' }), { params: { id: parent.id } });
    expect(res.status).toBe(200);
    await expect(accessTokenRepo.resolveParentId(q, token)).rejects.toThrow();
  });
});
