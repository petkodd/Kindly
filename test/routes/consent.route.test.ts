import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { consentRepo } from '../../src/lib/repos/consent';
import { accessTokenRepo } from '../../src/lib/repos/accessToken';
import { signSession, SESSION_COOKIE } from '../../src/lib/session';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { POST as talkConsentPOST } from '../../src/app/api/talk/consent/route';
import { POST as parentConsentPOST } from '../../src/app/api/parents/[id]/consent/route';
import { POST as revokePOST } from '../../src/app/api/consent/[cid]/revoke/route';

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function makeParent(buyerId: string): Promise<string> {
  const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });
  return parent.id;
}

function buyerReq(url: string, buyerId: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${signSession(buyerId)}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function talkReq(url: string, token: string | null): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
});

describe('POST /api/talk/consent', () => {
  it('401s without a valid parent access token', async () => {
    const res = await talkConsentPOST(talkReq('http://localhost/api/talk/consent', null));
    expect(res.status).toBe(401);
  });

  it('records parent_conversation consent, idempotently, given a valid token', async () => {
    const buyerId = await makeBuyer('sarah@example.com');
    const parentId = await makeParent(buyerId);
    const { token } = await accessTokenRepo.issue(q, parentId);

    const first = await talkConsentPOST(talkReq('http://localhost/api/talk/consent', token));
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await talkConsentPOST(talkReq('http://localhost/api/talk/consent', token));
    expect(second.status).toBe(201);
    const secondBody = await second.json();

    expect(secondBody.consent.id).toBe(firstBody.consent.id);
    expect(await consentRepo.list(q, parentId, 'parent_conversation')).toHaveLength(1);
  });
});

describe('POST /api/parents/:id/consent', () => {
  it('401s without a buyer session', async () => {
    const buyerId = await makeBuyer('sarah@example.com');
    const parentId = await makeParent(buyerId);
    const req = new NextRequest(`http://localhost/api/parents/${parentId}/consent`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'buyer_attestation' }),
    });
    const res = await parentConsentPOST(req, { params: { id: parentId } });
    expect(res.status).toBe(401);
  });

  it('404s for a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer('owner@example.com');
    const parentId = await makeParent(owner);
    const attacker = await makeBuyer('attacker@example.com');

    const res = await parentConsentPOST(
      buyerReq(`http://localhost/api/parents/${parentId}/consent`, attacker, { kind: 'buyer_attestation' }),
      { params: { id: parentId } },
    );
    expect(res.status).toBe(404);
  });

  it('records buyer_attestation idempotently for the owning buyer', async () => {
    const buyerId = await makeBuyer('sarah@example.com');
    const parentId = await makeParent(buyerId);

    const first = await parentConsentPOST(
      buyerReq(`http://localhost/api/parents/${parentId}/consent`, buyerId, { kind: 'buyer_attestation' }),
      { params: { id: parentId } },
    );
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await parentConsentPOST(
      buyerReq(`http://localhost/api/parents/${parentId}/consent`, buyerId, { kind: 'buyer_attestation' }),
      { params: { id: parentId } },
    );
    const secondBody = await second.json();
    expect(secondBody.consent.id).toBe(firstBody.consent.id);
  });
});

describe('POST /api/consent/:cid/revoke', () => {
  it('401s without a buyer session', async () => {
    const req = new NextRequest('http://localhost/api/consent/whatever/revoke', { method: 'POST' });
    const res = await revokePOST(req, { params: { cid: 'whatever' } });
    expect(res.status).toBe(401);
  });

  it('404s revoking a consent that belongs to another buyer', async () => {
    const owner = await makeBuyer('owner@example.com');
    const parentId = await makeParent(owner);
    const consent = await consentRepo.record(q, {
      parentId,
      kind: 'summary_recipient',
      detail: { recipient_email: 'sib@example.com' },
    });
    const attacker = await makeBuyer('attacker@example.com');

    const res = await revokePOST(
      buyerReq(`http://localhost/api/consent/${consent.id}/revoke`, attacker),
      { params: { cid: consent.id } },
    );
    expect(res.status).toBe(404);
  });

  it('revokes a summary_recipient consent owned by the caller', async () => {
    const buyerId = await makeBuyer('sarah@example.com');
    const parentId = await makeParent(buyerId);
    const consent = await consentRepo.record(q, {
      parentId,
      kind: 'summary_recipient',
      detail: { recipient_email: 'sib@example.com' },
    });

    const res = await revokePOST(
      buyerReq(`http://localhost/api/consent/${consent.id}/revoke`, buyerId),
      { params: { cid: consent.id } },
    );
    expect(res.status).toBe(200);
    expect(await consentRepo.list(q, parentId, 'summary_recipient')).toHaveLength(0);
  });
});
