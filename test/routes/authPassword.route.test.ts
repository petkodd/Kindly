import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { userRepo } from '../../src/lib/repos/user';
import { magicLinkRepo } from '../../src/lib/repos/magicLink';
import { signSession, SESSION_COOKIE } from '../../src/lib/session';
import { resolveBuyer } from '../../src/lib/auth';
import { fakeEmailClient, resetEmailClient } from '../../src/lib/email';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { POST as forgotPOST } from '../../src/app/api/auth/password/forgot/route';
import { POST as resetPOST } from '../../src/app/api/auth/password/reset/route';
import { POST as magicVerifyPOST } from '../../src/app/api/auth/magic/verify/route';
import { POST as loginPOST } from '../../src/app/api/auth/login/route';
import { POST as resendPOST } from '../../src/app/api/auth/verify-email/resend/route';

function post(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', ...headers },
    body: JSON.stringify(body),
  });
}
const forgot = (email: string, ip = '1.2.3.4') => forgotPOST(post('http://localhost/api/auth/password/forgot', { email }, { 'x-forwarded-for': ip }));
const reset = (token: string, password: string) => resetPOST(post('http://localhost/api/auth/password/reset', { token, password }));
const login = (email: string, password: string, ip: string) => loginPOST(post('http://localhost/api/auth/login', { email, password }, { 'x-forwarded-for': ip }));
const tokenFrom = (html: string) => new URL(html.match(/href="([^"]+)"/)![1]).searchParams.get('token')!;
const asBuyer = (token: string) =>
  new NextRequest('http://localhost/api/account', { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
  delete process.env.EMAIL_API_KEY;
  resetEmailClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/auth/password/forgot', () => {
  it('always 200s with the same body; only a real account gets an email', async () => {
    await userRepo.create(q, { email: 'sarah@example.com', password: 'correct-horse' });
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');

    const known = await forgot('sarah@example.com', '2.0.0.1');
    const unknown = await forgot('ghost@example.com', '2.0.0.2');
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0].to).toBe('sarah@example.com');
    expect(sendSpy.mock.calls[0][0].html).toContain('/login/reset?token=');
  });

  it('429s after 3 requests for one email in an hour (no inbox flooding)', async () => {
    await userRepo.create(q, { email: 'sarah@example.com', password: 'correct-horse' });
    for (let i = 0; i < 3; i++) expect((await forgot('sarah@example.com', `2.1.0.${i}`)).status).toBe(200);
    expect((await forgot('sarah@example.com', '2.1.0.9')).status).toBe(429);
  });
});

describe('POST /api/auth/password/reset', () => {
  async function requestReset(): Promise<{ userId: string; token: string }> {
    const user = await userRepo.create(q, { email: 'sarah@example.com', password: 'old-password' });
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    await forgot('sarah@example.com');
    return { userId: user.id, token: tokenFrom(sendSpy.mock.calls[0][0].html) };
  }

  it('sets a new password without the current one, revokes every session, and does not sign in', async () => {
    const { userId, token } = await requestReset();
    const oldSession = signSession(userId);
    expect(await resolveBuyer(asBuyer(oldSession), q)).toBe(userId);
    await tick();

    const res = await reset(token, 'brand-new-password');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') ?? '').toMatch(/Max-Age=0|kindly_session=;/i);

    expect(await resolveBuyer(asBuyer(oldSession), q)).toBeNull(); // every device signed out
    await tick();
    expect((await login('sarah@example.com', 'old-password', '3.0.0.1')).status).toBe(401);
    expect((await login('sarah@example.com', 'brand-new-password', '3.0.0.2')).status).toBe(200);

    const { rows } = await q.query(`SELECT 1 FROM audit_log WHERE action = 'password_reset' AND target_id = $1`, [userId]);
    expect(rows).toHaveLength(1);
  });

  it('the link is single-use', async () => {
    const { token } = await requestReset();
    expect((await reset(token, 'brand-new-password')).status).toBe(200);
    expect((await reset(token, 'another-password')).status).toBe(404);
  });

  it('a too-short password is rejected without spending the link', async () => {
    const { token } = await requestReset();
    expect((await reset(token, 'short')).status).toBe(400);
    expect((await reset(token, 'long-enough-now')).status).toBe(200);
  });

  it('a sign-in (magic) link cannot reset a password', async () => {
    const user = await userRepo.create(q, { email: 'sarah@example.com', password: 'old-password' });
    const { token } = await magicLinkRepo.issue(q, user.id, { purpose: 'login' });
    expect((await reset(token, 'brand-new-password')).status).toBe(404);
    expect(await userRepo.verifyCredentials(q, 'sarah@example.com', 'old-password')).not.toBeNull();
  });

  it('a reset link cannot be used to sign in', async () => {
    const { token } = await requestReset();
    const res = await magicVerifyPOST(post('http://localhost/api/auth/magic/verify', { token }));
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
    // …and it was not consumed by that attempt.
    expect((await reset(token, 'brand-new-password')).status).toBe(200);
  });

  it('a garbage token 404s', async () => {
    expect((await reset('not-a-token', 'brand-new-password')).status).toBe(404);
  });

  it('a reset also verifies the email (they proved they read the inbox)', async () => {
    const user = await userRepo.create(q, { email: 'sarah@example.com', password: 'old-password' });
    await q.query(`UPDATE users SET email_verified_at = NULL WHERE id = $1`, [user.id]);
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    await forgot('sarah@example.com');
    await reset(tokenFrom(sendSpy.mock.calls[0][0].html), 'brand-new-password');
    expect(await userRepo.isEmailVerified(q, user.id)).toBe(true);
  });
});

describe('POST /api/auth/verify-email/resend', () => {
  it('401s without a session', async () => {
    expect((await resendPOST(post('http://localhost/api/auth/verify-email/resend', {}))).status).toBe(401);
  });

  it('emails a fresh confirmation link to an unverified buyer, max 3 per hour', async () => {
    const user = await userRepo.create(q, { email: 'sarah@example.com', password: 'correct-horse' });
    await q.query(`UPDATE users SET email_verified_at = NULL WHERE id = $1`, [user.id]);
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    const req = () =>
      resendPOST(new NextRequest('http://localhost/api/auth/verify-email/resend', {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE}=${signSession(user.id)}` },
      }));

    for (let i = 0; i < 3; i++) expect((await req()).status).toBe(200);
    expect((await req()).status).toBe(429);
    expect(sendSpy).toHaveBeenCalledTimes(3);
    expect(sendSpy.mock.calls[0][0].html).toContain('/login/verify?token=');
  });

  it('short-circuits for an already-verified buyer', async () => {
    const user = await userRepo.create(q, { email: 'sarah@example.com', password: 'correct-horse' });
    await userRepo.markEmailVerified(q, user.id);
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    const res = await resendPOST(new NextRequest('http://localhost/api/auth/verify-email/resend', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${signSession(user.id)}` },
    }));
    expect(await res.json()).toEqual({ ok: true, already_verified: true });
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
