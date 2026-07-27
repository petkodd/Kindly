import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { consentRepo } from '../../src/lib/repos/consent';
import { signSession, SESSION_COOKIE } from '../../src/lib/session';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handler picks up the mocked db().
import { POST as parentConsentPOST } from '../../src/app/api/parents/[id]/consent/route';

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

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
});

describe('POST /api/parents/:id/consent', () => {
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

  // Regression for the consent-gate bypass: a buyer must never be able to
  // self-attest a third party's summary_recipient consent through this route.
  // That consent may only be created 'pending' via the token-gated
  // invite-sibling flow and flipped to 'accepted' by the recipient themself.
  it('rejects kind=summary_recipient instead of recording it inline', async () => {
    const buyerId = await makeBuyer('sarah@example.com');
    const parentId = await makeParent(buyerId);

    const res = await parentConsentPOST(
      buyerReq(`http://localhost/api/parents/${parentId}/consent`, buyerId, {
        kind: 'summary_recipient',
        detail: { recipient_email: 'thirdparty@example.com' },
      }),
      { params: { id: parentId } },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_input');
    expect(await consentRepo.list(q, parentId, 'summary_recipient')).toHaveLength(0);
  });

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
});
