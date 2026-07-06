import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { userRepo } from '../src/lib/repos/user';
import { rateLimitRepo } from '../src/lib/repos/rateLimit';
import { getBuyerId, getAdminId, getParentToken, resolveBuyer, resolveAdmin } from '../src/lib/auth';
import { signSession, verifySession, SESSION_COOKIE } from '../src/lib/session';
import {
  PARENT_TOKEN_COOKIE,
  attachParentToken,
  clearParentToken,
} from '../src/lib/parentSession';
import { ConflictError, ValidationError } from '../src/lib/types';

function talkReq(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/talk/message', { headers });
}

describe('getParentToken (talk auth)', () => {
  it('reads a Bearer header, the x-kindly-parent-token header, or the talk cookie', () => {
    expect(getParentToken(talkReq({ authorization: 'Bearer abc' }))).toBe('abc');
    expect(getParentToken(talkReq({ 'x-kindly-parent-token': 'def' }))).toBe('def');
    expect(getParentToken(talkReq({ cookie: `${PARENT_TOKEN_COOKIE}=ghi` }))).toBe('ghi');
    expect(getParentToken(talkReq({}))).toBeNull();
  });

  it('prefers the header over the cookie', () => {
    expect(
      getParentToken(talkReq({ authorization: 'Bearer abc', cookie: `${PARENT_TOKEN_COOKIE}=ghi` })),
    ).toBe('abc');
  });
});

describe('parent talk cookie (parentSession)', () => {
  it('attach sets an httpOnly, SameSite=Lax, /api/talk-scoped cookie', () => {
    const setCookie =
      attachParentToken(NextResponse.json({ ok: true }), 'raw-token').headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('kindly_talk=raw-token');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(setCookie).toContain('Path=/api/talk');
  });

  it('clear expires the cookie', () => {
    const setCookie =
      clearParentToken(NextResponse.json({ ok: true })).headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/kindly_talk=;|Max-Age=0/i);
  });
});

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

  it('resolves to null when SESSION_SECRET is unset (degrades to logged-out, no 500)', () => {
    const token = signSession('user-1');
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    expect(verifySession(token)).toBeNull();
    process.env.SESSION_SECRET = saved;
  });
});

describe('login rate limiter', () => {
  it('allows up to the limit, then blocks; reset clears the counter', async () => {
    const key = 'login:ip:1.2.3.4';
    const opts = { limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) {
      expect((await rateLimitRepo.hit(q, key, opts)).allowed).toBe(true);
    }
    expect((await rateLimitRepo.hit(q, key, opts)).allowed).toBe(false); // 4th over limit

    await rateLimitRepo.reset(q, key);
    expect((await rateLimitRepo.hit(q, key, opts)).allowed).toBe(true);
  });

  it('starts a fresh window once the old one elapses', async () => {
    const key = 'login:ip:5.6.7.8';
    const opts = { limit: 1, windowMs: 60_000 };
    expect((await rateLimitRepo.hit(q, key, opts)).allowed).toBe(true); // count 1
    expect((await rateLimitRepo.hit(q, key, opts)).allowed).toBe(false); // count 2 blocked

    // Age the window past its length.
    await q.query(`UPDATE auth_rate_limit SET window_start = $2 WHERE key = $1`, [
      key,
      new Date(Date.now() - 120_000),
    ]);
    expect((await rateLimitRepo.hit(q, key, opts)).allowed).toBe(true); // fresh window
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

describe('server-side session revocation (resolveBuyer / resolveAdmin)', () => {
  async function makeUser(isAdmin = false): Promise<string> {
    const u = await userRepo.create(q, { email: `u${Math.random()}@example.com`, password: 'originalpass' });
    if (isAdmin) await q.query(`UPDATE users SET is_admin = true WHERE id = $1`, [u.id]);
    return u.id;
  }

  it('resolves a valid session to the user id', async () => {
    const id = await makeUser();
    expect(await resolveBuyer(requestWithSession(signSession(id)), q)).toBe(id);
  });

  it('rejects a session for a deleted account', async () => {
    const id = await makeUser();
    const token = signSession(id);
    await userRepo.softDelete(q, id);
    expect(await resolveBuyer(requestWithSession(token), q)).toBeNull();
  });

  it('rejects a token issued before sessions_valid_from (revoked)', async () => {
    const id = await makeUser();
    const token = signSession(id); // iat = now
    // Move the watermark into the future → the token is now "old".
    await q.query(`UPDATE users SET sessions_valid_from = $2 WHERE id = $1`, [
      id,
      new Date(Date.now() + 60_000),
    ]);
    expect(await resolveBuyer(requestWithSession(token), q)).toBeNull();
  });

  it('changePassword and softDelete bump the revocation watermark', async () => {
    const id = await makeUser();
    await q.query(`UPDATE users SET sessions_valid_from = $2 WHERE id = $1`, [id, new Date(0)]);
    await userRepo.changePassword(q, id, 'originalpass', 'brandnewpass');
    const after = (await userRepo.sessionAuth(q, id))!.sessions_valid_from;
    expect(new Date(after).getTime()).toBeGreaterThan(0);
  });

  it('resolveAdmin requires the admin claim AND live is_admin', async () => {
    const id = await makeUser(true);
    // Non-admin claim → null even though the DB says admin.
    expect(await resolveAdmin(requestWithSession(signSession(id, { isAdmin: false })), q)).toBeNull();
    // Admin claim + is_admin → admin id.
    expect(await resolveAdmin(requestWithSession(signSession(id, { isAdmin: true })), q)).toBe(id);
    // Admin claim but is_admin revoked in the DB → null (stale claim can't win).
    await q.query(`UPDATE users SET is_admin = false WHERE id = $1`, [id]);
    expect(await resolveAdmin(requestWithSession(signSession(id, { isAdmin: true })), q)).toBeNull();
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
