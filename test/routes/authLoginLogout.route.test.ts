import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { userRepo } from '../../src/lib/repos/user';
import { SESSION_COOKIE, verifySession, signSession } from '../../src/lib/session';
import { resolveBuyer } from '../../src/lib/auth';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { POST as loginPOST } from '../../src/app/api/auth/login/route';
import { POST as logoutPOST } from '../../src/app/api/auth/logout/route';

function loginReq(body: unknown, ip = '1.2.3.4'): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
});

describe('POST /api/auth/login', () => {
  it('401s an unknown email and a wrong password identically', async () => {
    await userRepo.create(q, { email: 'sarah@example.com', password: 'correct-horse' });

    const unknown = await loginPOST(loginReq({ email: 'ghost@example.com', password: 'whatever' }, '10.0.0.1'));
    const wrong = await loginPOST(loginReq({ email: 'sarah@example.com', password: 'wrong-pass' }, '10.0.0.2'));
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect((await unknown.json()).error.code).toBe((await wrong.json()).error.code);
  });

  it('logs in with correct credentials and sets a valid session cookie', async () => {
    const user = await userRepo.create(q, { email: 'sarah@example.com', password: 'correct-horse' });

    const res = await loginPOST(loginReq({ email: 'sarah@example.com', password: 'correct-horse' }, '10.0.0.3'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(user.id);

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    const token = setCookie.split(`${SESSION_COOKIE}=`)[1].split(';')[0];
    expect(verifySession(token)?.uid).toBe(user.id);
  });

  it('429s one email after 10 failures, even when every guess comes from a different IP', async () => {
    await userRepo.create(q, { email: 'sarah@example.com', password: 'correct-horse' });
    for (let i = 0; i < 10; i++) {
      const res = await loginPOST(loginReq({ email: 'sarah@example.com', password: `guess-${i}` }, `10.1.0.${i}`));
      expect(res.status).toBe(401);
    }
    const blocked = await loginPOST(loginReq({ email: 'Sarah@Example.com ', password: 'guess-x' }, '10.1.0.99'));
    expect(blocked.status).toBe(429);
    // While throttled, even the right password is refused (no oracle).
    const right = await loginPOST(loginReq({ email: 'sarah@example.com', password: 'correct-horse' }, '10.1.0.100'));
    expect(right.status).toBe(429);
  });

  it('429s one IP after 20 attempts spread across many emails', async () => {
    const ip = '10.2.0.1';
    for (let i = 0; i < 20; i++) {
      const res = await loginPOST(loginReq({ email: `user${i}@example.com`, password: 'nope-nope' }, ip));
      expect(res.status).toBe(401);
    }
    const blocked = await loginPOST(loginReq({ email: 'fresh@example.com', password: 'nope-nope' }, ip));
    expect(blocked.status).toBe(429);
  });

  it('brute force: interleaving a real login does NOT reset the counters (bypass closed)', async () => {
    // The attacker owns one account and knows its password; before chat 7 a
    // success reset the IP counter, so "9 guesses + 1 real login" repeated forever.
    await userRepo.create(q, { email: 'victim@example.com', password: 'victim-secret' });
    await userRepo.create(q, { email: 'attacker@example.com', password: 'attacker-pass' });
    const ip = '10.3.0.1';

    const statuses: number[] = [];
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 6; i++) {
        statuses.push((await loginPOST(loginReq({ email: 'victim@example.com', password: `g${round}-${i}` }, ip))).status);
      }
      statuses.push((await loginPOST(loginReq({ email: 'attacker@example.com', password: 'attacker-pass' }, ip))).status);
    }
    // 10 victim guesses allowed in total, then the per-email limit holds.
    const victimGuesses = statuses.filter((_, i) => i % 7 !== 6);
    expect(victimGuesses.filter((s) => s === 401)).toHaveLength(10);
    expect(victimGuesses.slice(10).every((s) => s === 429)).toBe(true);

    // And the per-IP limit (20) is not reset by the attacker's own successes either.
    let last;
    for (let i = 0; i < 5; i++) {
      last = await loginPOST(loginReq({ email: `other${i}@example.com`, password: 'x-x-x-x-x' }, ip));
    }
    expect(last!.status).toBe(429);
  });

  it('403s a cross-site login POST (login CSRF)', async () => {
    await userRepo.create(q, { email: 'sarah@example.com', password: 'correct-horse' });
    const res = await loginPOST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ email: 'sarah@example.com', password: 'correct-horse' }),
      }),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('upgrades a legacy password hash on the next successful login', async () => {
    const user = await userRepo.create(q, { email: 'old@example.com', password: 'placeholder' });
    // A pre-chat-7 hash: `salt:key`, scrypt N=2^14, made with the old sync code.
    const { scryptSync, randomBytes } = await import('node:crypto');
    const salt = randomBytes(16);
    const legacy = `${salt.toString('hex')}:${scryptSync('legacy-pass', salt, 64).toString('hex')}`;
    await q.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [legacy, user.id]);

    const res = await loginPOST(loginReq({ email: 'old@example.com', password: 'legacy-pass' }, '10.4.0.1'));
    expect(res.status).toBe(200);
    const { rows } = await q.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    expect(rows[0].password_hash.startsWith('scrypt$')).toBe(true);
    // Still the same password afterwards.
    const again = await loginPOST(loginReq({ email: 'old@example.com', password: 'legacy-pass' }, '10.4.0.2'));
    expect(again.status).toBe(200);
  });
});

describe('POST /api/auth/logout', () => {
  function cookieReq(url: string, token?: string, method = 'POST'): NextRequest {
    return new NextRequest(url, { method, headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {} });
  }

  it('204s and clears the session cookie (also without a session)', async () => {
    const res = await logoutPOST(cookieReq('http://localhost/api/auth/logout'));
    expect(res.status).toBe(204);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(new RegExp(`${SESSION_COOKIE}=;|Max-Age=0`, 'i'));
  });

  it('revokes the token server-side: a copied cookie stops working after logout', async () => {
    const user = await userRepo.create(q, { email: 'sarah@example.com', password: 'correct-horse' });
    const login = await loginPOST(loginReq({ email: 'sarah@example.com', password: 'correct-horse' }, '10.5.0.1'));
    const token = (login.headers.get('set-cookie') ?? '').split(`${SESSION_COOKIE}=`)[1].split(';')[0];
    // A second device signed in earlier.
    const otherDevice = signSession(user.id);

    expect(await resolveBuyer(cookieReq('http://localhost/api/account', token, 'GET'), q)).toBe(user.id);
    await new Promise((r) => setTimeout(r, 5)); // logout strictly after issue (ms watermark)

    const res = await logoutPOST(cookieReq('http://localhost/api/auth/logout', token));
    expect(res.status).toBe(204);

    // The token is still cryptographically valid, but the server refuses it.
    expect(verifySession(token)?.uid).toBe(user.id);
    expect(await resolveBuyer(cookieReq('http://localhost/api/account', token, 'GET'), q)).toBeNull();
    expect(await resolveBuyer(cookieReq('http://localhost/api/account', otherDevice, 'GET'), q)).toBeNull();

    // Signing in again afterwards works.
    await new Promise((r) => setTimeout(r, 5));
    const relogin = await loginPOST(loginReq({ email: 'sarah@example.com', password: 'correct-horse' }, '10.5.0.2'));
    const fresh = (relogin.headers.get('set-cookie') ?? '').split(`${SESSION_COOKIE}=`)[1].split(';')[0];
    expect(await resolveBuyer(cookieReq('http://localhost/api/account', fresh, 'GET'), q)).toBe(user.id);
  });

  it('a cross-site logout POST is refused and revokes nothing', async () => {
    const user = await userRepo.create(q, { email: 'sarah@example.com', password: 'correct-horse' });
    const token = signSession(user.id);
    await new Promise((r) => setTimeout(r, 5));
    const res = await logoutPOST(
      new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE}=${token}`, origin: 'https://evil.example' },
      }),
    );
    expect(res.status).toBe(403);
    expect(await resolveBuyer(cookieReq('http://localhost/api/account', token, 'GET'), q)).toBe(user.id);
  });
});
