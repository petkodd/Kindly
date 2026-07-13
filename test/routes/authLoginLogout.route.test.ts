import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { userRepo } from '../../src/lib/repos/user';
import { SESSION_COOKIE, verifySession } from '../../src/lib/session';

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

  it('429s after exceeding the per-IP login rate limit', async () => {
    await userRepo.create(q, { email: 'sarah@example.com', password: 'correct-horse' });
    const ip = '10.0.0.9';

    let last;
    for (let i = 0; i < 11; i++) {
      last = await loginPOST(loginReq({ email: 'sarah@example.com', password: 'wrong-pass' }, ip));
    }
    expect(last!.status).toBe(429);
  });

  it('a successful login resets the rate-limit counter for that IP', async () => {
    await userRepo.create(q, { email: 'sarah@example.com', password: 'correct-horse' });
    const ip = '10.0.0.10';

    for (let i = 0; i < 5; i++) {
      await loginPOST(loginReq({ email: 'sarah@example.com', password: 'wrong-pass' }, ip));
    }
    const success = await loginPOST(loginReq({ email: 'sarah@example.com', password: 'correct-horse' }, ip));
    expect(success.status).toBe(200);

    // Counter reset — a handful more failed attempts should not yet 429.
    const after = await loginPOST(loginReq({ email: 'sarah@example.com', password: 'wrong-pass' }, ip));
    expect(after.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('204s and clears the session cookie', async () => {
    const res = await logoutPOST();
    expect(res.status).toBe(204);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(new RegExp(`${SESSION_COOKIE}=;|Max-Age=0`, 'i'));
  });
});
