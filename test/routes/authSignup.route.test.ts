import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { userRepo } from '../../src/lib/repos/user';
import { fakeEmailClient, resetEmailClient } from '../../src/lib/email';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { POST as signupPOST } from '../../src/app/api/auth/signup/route';
import { POST as magicVerifyPOST } from '../../src/app/api/auth/magic/verify/route';

function signupReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', ...headers },
    body: JSON.stringify(body),
  });
}

function tokenFrom(html: string): string {
  return new URL(html.match(/href="([^"]+)"/)![1]).searchParams.get('token')!;
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
  delete process.env.EMAIL_API_KEY;
  resetEmailClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/auth/signup', () => {
  it('creates an unverified account, emails a confirmation link, emits account_created, sets no cookie', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    const res = await signupPOST(signupReq({ email: 'sarah@example.com', password: 'correct-horse' }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, next: 'check_email' });
    expect(res.headers.get('set-cookie')).toBeNull();

    const user = await userRepo.findByEmail(q, 'sarah@example.com');
    expect(user).not.toBeNull();
    expect(await userRepo.isEmailVerified(q, user!.id)).toBe(false);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0].to).toBe('sarah@example.com');
    expect(sendSpy.mock.calls[0][0].html).toContain('/login/verify?token=');

    const { rows } = await q.query<{ user_id: string; props: { method: string } }>(
      `SELECT user_id, props FROM analytics_events WHERE event_name = 'account_created'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(user!.id);
    expect(rows[0].props.method).toBe('password');
  });

  it('clicking the emailed link verifies the email and signs the buyer in', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    await signupPOST(signupReq({ email: 'sarah@example.com', password: 'correct-horse' }));
    const token = tokenFrom(sendSpy.mock.calls[0][0].html);

    const res = await magicVerifyPOST(
      new NextRequest('http://localhost/api/auth/magic/verify', { method: 'POST', body: JSON.stringify({ token }) }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('kindly_session=');
    const user = await userRepo.findByEmail(q, 'sarah@example.com');
    expect(await userRepo.isEmailVerified(q, user!.id)).toBe(true);
  });

  it('an existing email gets the identical response, no account change, and an "already have an account" email', async () => {
    const existing = await userRepo.create(q, { email: 'sarah@example.com', password: 'original-pass' });
    const before = await q.query(`SELECT password_hash, sessions_valid_from FROM users WHERE id = $1`, [existing.id]);
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');

    const fresh = await signupPOST(signupReq({ email: 'new@example.com', password: 'correct-horse' }, { 'x-forwarded-for': '5.5.5.1' }));
    const dup = await signupPOST(signupReq({ email: 'sarah@example.com', password: 'attacker-pass' }, { 'x-forwarded-for': '5.5.5.2' }));

    expect(dup.status).toBe(fresh.status);
    expect(await dup.json()).toEqual(await fresh.json());
    expect(dup.headers.get('set-cookie')).toBeNull();

    const after = await q.query(`SELECT password_hash, sessions_valid_from FROM users WHERE id = $1`, [existing.id]);
    expect(after.rows[0]).toEqual(before.rows[0]); // password not overwritten
    expect(await userRepo.verifyCredentials(q, 'sarah@example.com', 'original-pass')).not.toBeNull();

    expect(sendSpy).toHaveBeenCalledTimes(2);
    const notice = sendSpy.mock.calls[1][0];
    expect(notice.to).toBe('sarah@example.com');
    expect(notice.html).toContain('/login/forgot');
    expect(notice.html).not.toContain('token=');
  });

  it('validation errors are the same whether or not the email exists', async () => {
    await userRepo.create(q, { email: 'sarah@example.com', password: 'original-pass' });
    const a = await signupPOST(signupReq({ email: 'sarah@example.com', password: 'short' }, { 'x-forwarded-for': '6.6.6.1' }));
    const b = await signupPOST(signupReq({ email: 'nobody@example.com', password: 'short' }, { 'x-forwarded-for': '6.6.6.2' }));
    expect(a.status).toBe(400);
    expect(await a.json()).toEqual(await b.json());
  });

  it('429s an IP after 10 signups in an hour', async () => {
    let last;
    for (let i = 0; i < 11; i++) {
      last = await signupPOST(signupReq({ email: `u${i}@example.com`, password: 'correct-horse' }, { 'x-forwarded-for': '7.7.7.7' }));
    }
    expect(last!.status).toBe(429);
  });

  it('403s a cross-site signup', async () => {
    const res = await signupPOST(signupReq({ email: 'sarah@example.com', password: 'correct-horse' }, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(await userRepo.findByEmail(q, 'sarah@example.com')).toBeNull();
  });
});
