import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { userRepo } from '../../src/lib/repos/user';
import { SESSION_COOKIE, verifySession } from '../../src/lib/session';
import { fakeEmailClient, resetEmailClient } from '../../src/lib/email';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { POST as magicPOST } from '../../src/app/api/auth/magic/route';
import { POST as magicVerifyPOST } from '../../src/app/api/auth/magic/verify/route';

function jsonReq(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
  delete process.env.EMAIL_API_KEY; // force the fake client
  resetEmailClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/auth/magic', () => {
  it('returns 200 for an unknown email and sends no mail (no enumeration)', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    const res = await magicPOST(jsonReq('http://localhost/api/auth/magic', { email: 'ghost@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('returns the identical 200 for a known email and emails a sign-in link', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    await userRepo.create(q, { email: 'sarah@example.com', password: 'hunter2horse' });

    const res = await magicPOST(jsonReq('http://localhost/api/auth/magic', { email: 'sarah@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = sendSpy.mock.calls[0][0];
    expect(sent.to).toBe('sarah@example.com');
    expect(sent.html).toContain('/login/verify?token=');
  });

  it('429s once the per-IP rate limit is exceeded', async () => {
    await userRepo.create(q, { email: 'sarah@example.com', password: 'hunter2horse' });
    const req = () =>
      new NextRequest('http://localhost/api/auth/magic', {
        method: 'POST',
        headers: { 'x-forwarded-for': '9.9.9.9' },
        body: JSON.stringify({ email: 'sarah@example.com' }),
      });
    let last;
    for (let i = 0; i < 6; i++) last = await magicPOST(req());
    expect(last!.status).toBe(429);
  });
});

describe('POST /api/auth/magic/verify', () => {
  it('404s an unknown/invalid token', async () => {
    const res = await magicVerifyPOST(jsonReq('http://localhost/api/auth/magic/verify', { token: 'nope' }));
    expect(res.status).toBe(404);
  });

  it('issues a session cookie for a valid token, end-to-end from the emailed link', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    const user = await userRepo.create(q, { email: 'sarah@example.com', password: 'hunter2horse' });
    await magicPOST(jsonReq('http://localhost/api/auth/magic', { email: 'sarah@example.com' }));

    const { html } = sendSpy.mock.calls[0][0];
    const token = new URL(html.match(/href="([^"]+)"/)![1]).searchParams.get('token')!;

    const res = await magicVerifyPOST(jsonReq('http://localhost/api/auth/magic/verify', { token }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    const cookieToken = setCookie.split(`${SESSION_COOKIE}=`)[1].split(';')[0];
    expect(verifySession(cookieToken)?.uid).toBe(user.id);
  });

  it('is single-use — the same token cannot be consumed twice', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    await userRepo.create(q, { email: 'sarah@example.com', password: 'hunter2horse' });
    await magicPOST(jsonReq('http://localhost/api/auth/magic', { email: 'sarah@example.com' }));
    const { html } = sendSpy.mock.calls[0][0];
    const token = new URL(html.match(/href="([^"]+)"/)![1]).searchParams.get('token')!;

    const first = await magicVerifyPOST(jsonReq('http://localhost/api/auth/magic/verify', { token }));
    expect(first.status).toBe(200);
    const second = await magicVerifyPOST(jsonReq('http://localhost/api/auth/magic/verify', { token }));
    expect(second.status).toBe(404);
  });

  it('rejects an expired token', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    await userRepo.create(q, { email: 'sarah@example.com', password: 'hunter2horse' });
    await magicPOST(jsonReq('http://localhost/api/auth/magic', { email: 'sarah@example.com' }));
    const { html } = sendSpy.mock.calls[0][0];
    const token = new URL(html.match(/href="([^"]+)"/)![1]).searchParams.get('token')!;

    await q.query(`UPDATE magic_link_tokens SET expires_at = now() - interval '1 minute'`);
    const res = await magicVerifyPOST(jsonReq('http://localhost/api/auth/magic/verify', { token }));
    expect(res.status).toBe(404);
  });

  it('404s for a deleted account even with a freshly issued token', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    const user = await userRepo.create(q, { email: 'sarah@example.com', password: 'hunter2horse' });
    await magicPOST(jsonReq('http://localhost/api/auth/magic', { email: 'sarah@example.com' }));
    const { html } = sendSpy.mock.calls[0][0];
    const token = new URL(html.match(/href="([^"]+)"/)![1]).searchParams.get('token')!;

    await userRepo.softDelete(q, user.id);
    const res = await magicVerifyPOST(jsonReq('http://localhost/api/auth/magic/verify', { token }));
    expect(res.status).toBe(404);
  });
});
