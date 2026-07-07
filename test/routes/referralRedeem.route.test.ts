import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { referralRepo } from '../../src/lib/repos/referral';
import { signSession, SESSION_COOKIE } from '../../src/lib/session';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handler picks up the mocked db().
import { POST as redeemPOST } from '../../src/app/api/referrals/redeem/route';

async function makeUser(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

function redeemReq(buyerId: string, body: unknown, ip = '1.2.3.4'): NextRequest {
  return new NextRequest('http://localhost/api/referrals/redeem', {
    method: 'POST',
    headers: {
      cookie: `${SESSION_COOKIE}=${signSession(buyerId)}`,
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
});

describe('POST /api/referrals/redeem', () => {
  it('ignores a client-supplied household_hash — it cannot be used to dodge the household guard', async () => {
    const referrer = await makeUser('ref@example.com');
    const r1 = await referralRepo.generate(q, referrer);
    const r2 = await referralRepo.generate(q, referrer);

    const first = await makeUser('first@example.com');
    const res1 = await redeemPOST(
      redeemReq(first, { code: r1.code, household_hash: 'attacker-supplied-1' }, '5.5.5.5'),
    );
    expect(res1.status).toBe(200);

    // Same IP (same "household"), different code, different buyer, and a
    // DIFFERENT client-supplied household_hash — must still be blocked,
    // because the route derives the hash server-side and ignores the body.
    const second = await makeUser('second@example.com');
    const res2 = await redeemPOST(
      redeemReq(second, { code: r2.code, household_hash: 'attacker-supplied-2' }, '5.5.5.5'),
    );
    expect(res2.status).toBe(409);
  });

  it('a different IP is treated as a different household and can redeem', async () => {
    const referrer = await makeUser('ref2@example.com');
    const r1 = await referralRepo.generate(q, referrer);
    const r2 = await referralRepo.generate(q, referrer);

    await redeemPOST(redeemReq(await makeUser('a@example.com'), { code: r1.code }, '5.5.5.5'));
    const res = await redeemPOST(redeemReq(await makeUser('b@example.com'), { code: r2.code }, '9.9.9.9'));
    expect(res.status).toBe(200);
  });

  it('429s once the per-IP redemption rate limit is exceeded', async () => {
    const referrer = await makeUser('ref3@example.com');
    let last;
    for (let i = 0; i < 6; i++) {
      const buyer = await makeUser(`buyer${i}@example.com`);
      const referral = await referralRepo.generate(q, referrer);
      last = await redeemPOST(redeemReq(buyer, { code: referral.code }, '7.7.7.7'));
    }
    expect(last!.status).toBe(429);
  });

  it('401s without a signed-in buyer', async () => {
    const res = await redeemPOST(
      new NextRequest('http://localhost/api/referrals/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: 'ABCD1234' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('400s rather than fingerprinting an unresolvable IP — an "unknown" caller must not collide with another unrelated one', async () => {
    const referrer = await makeUser('ref4@example.com');
    const referral = await referralRepo.generate(q, referrer);
    const buyer = await makeUser('nohdr@example.com');
    const req = new NextRequest('http://localhost/api/referrals/redeem', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${signSession(buyer)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ code: referral.code }),
    }); // no x-forwarded-for header → clientIp() returns 'unknown'
    const res = await redeemPOST(req);
    expect(res.status).toBe(400);
  });
});
