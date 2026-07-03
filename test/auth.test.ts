import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { userRepo } from '../src/lib/repos/user';
import { getBuyerId, getAdminId } from '../src/lib/auth';
import { signSession, verifySession, SESSION_COOKIE } from '../src/lib/session';
import { ConflictError, ValidationError } from '../src/lib/types';

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-value';
});

let q: Querier;
beforeEach(() => {
  q = makeTestDb();
});

function requestWithSession(token: string): NextRequest {
  return new NextRequest('http://localhost/', { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
}

describe('session tokens', () => {
  it('round-trips uid + admin claim', () => {
    const token = signSession('user-1', { isAdmin: true });
    const claims = verifySession(token);
    expect(claims?.uid).toBe('user-1');
    expect(claims?.adm).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const token = signSession('user-1');
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 'attacker', adm: true, exp: 9999999999 })).toString('base64url');
    expect(verifySession(`${forged}.${sig}`)).toBeNull();
    expect(verifySession(`${body}.deadbeef`)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signSession('user-1', { ttlSeconds: -1 });
    expect(verifySession(token)).toBeNull();
  });

  it('rejects junk', () => {
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession('nonsense')).toBeNull();
  });
});

describe('session-based auth resolvers', () => {
  it('getBuyerId reads the signed cookie; getAdminId requires the admin claim', () => {
    const buyer = requestWithSession(signSession('u-buyer', { isAdmin: false }));
    expect(getBuyerId(buyer)).toBe('u-buyer');
    expect(getAdminId(buyer)).toBeNull(); // valid session, but not admin

    const admin = requestWithSession(signSession('u-admin', { isAdmin: true }));
    expect(getBuyerId(admin)).toBe('u-admin');
    expect(getAdminId(admin)).toBe('u-admin');
  });

  it('a forged cookie resolves to null (not spoofable)', () => {
    const forged = requestWithSession('u-attacker.forged-signature');
    expect(getBuyerId(forged)).toBeNull();
    expect(getAdminId(forged)).toBeNull();
  });
});

describe('user repo', () => {
  it('creates a buyer and stores a hash, not the plaintext password', async () => {
    const user = await userRepo.create(q, { email: 'sarah@example.com', password: 'hunter2horse' });
    expect(user.email).toBe('sarah@example.com');
    const { rows } = await q.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [user.id],
    );
    expect(rows[0].password_hash).not.toBe('hunter2horse');
    expect(rows[0].password_hash).toContain(':'); // salt:key
  });

  it('rejects a duplicate email (409), bad email, and short password', async () => {
    await userRepo.create(q, { email: 'sarah@example.com', password: 'hunter2horse' });
    // Exact-duplicate conflicts under both TEXT and CITEXT. (Case-insensitive
    // dedup is a CITEXT property; the test loader rewrites CITEXT→TEXT, so that
    // specific behavior is only exercised against real Postgres.)
    await expect(
      userRepo.create(q, { email: 'sarah@example.com', password: 'anotherpass' }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(userRepo.create(q, { email: 'nope', password: 'longenough' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(userRepo.create(q, { email: 'a@b.co', password: 'short' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('verifies correct credentials and rejects wrong password / unknown email uniformly', async () => {
    await userRepo.create(q, { email: 'sarah@example.com', password: 'hunter2horse' });
    expect(await userRepo.verifyCredentials(q, 'sarah@example.com', 'hunter2horse')).toMatchObject({
      email: 'sarah@example.com',
    });
    expect(await userRepo.verifyCredentials(q, 'sarah@example.com', 'wrongpass')).toBeNull();
    expect(await userRepo.verifyCredentials(q, 'ghost@example.com', 'whatever')).toBeNull();
  });
});
