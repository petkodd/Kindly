import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { referralRepo } from '../../src/lib/repos/referral';
import { signSession, SESSION_COOKIE } from '../../src/lib/session';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { GET as referralsGET, POST as referralsPOST } from '../../src/app/api/referrals/route';

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

function buyerReq(url: string, buyerId: string | null, init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (buyerId) headers.cookie = `${SESSION_COOKIE}=${signSession(buyerId)}`;
  return new NextRequest(url, { ...init, headers });
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
});

describe('GET /api/referrals', () => {
  it('401s without a buyer session', async () => {
    const res = await referralsGET(buyerReq('http://localhost/api/referrals', null));
    expect(res.status).toBe(401);
  });

  it('returns null before a code has been generated', async () => {
    const buyer = await makeBuyer('sarah@example.com');
    const res = await referralsGET(buyerReq('http://localhost/api/referrals', buyer));
    expect(res.status).toBe(200);
    expect((await res.json()).code).toBeNull();
  });

  it('returns the buyer\'s existing code', async () => {
    const buyer = await makeBuyer('sarah@example.com');
    const created = await referralRepo.generate(q, buyer);

    const res = await referralsGET(buyerReq('http://localhost/api/referrals', buyer));
    expect((await res.json()).code).toBe(created.code);
  });
});

describe('POST /api/referrals', () => {
  it('401s without a buyer session', async () => {
    const res = await referralsPOST(buyerReq('http://localhost/api/referrals', null, { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  it('generates a unique referral code for the caller', async () => {
    const buyer = await makeBuyer('sarah@example.com');
    const res = await referralsPOST(buyerReq('http://localhost/api/referrals', buyer, { method: 'POST' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toHaveLength(8);
    expect((await referralRepo.getForBuyer(q, buyer))?.code).toBe(body.code);
  });
});
