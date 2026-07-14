import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { userRepo } from '../../src/lib/repos/user';
import { verifySession, SESSION_COOKIE } from '../../src/lib/session';
import { authedReq } from './helpers';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { GET as meGET, PATCH as mePATCH, DELETE as meDELETE } from '../../src/app/api/me/route';
import { POST as passwordPOST } from '../../src/app/api/me/password/route';

async function makeAccount(): Promise<string> {
  const user = await userRepo.create(q, { email: `u${Math.random()}@example.com`, password: 'originalpass' });
  return user.id;
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
});

describe('GET /api/me', () => {
  it('401s without a session', async () => {
    const res = await meGET(authedReq('http://localhost/api/me', null));
    expect(res.status).toBe(401);
  });

  it('returns the signed-in account, no password hash', async () => {
    const id = await makeAccount();
    const res = await meGET(authedReq('http://localhost/api/me', id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.id).toBe(id);
    expect(body.account).not.toHaveProperty('password_hash');
  });
});

describe('PATCH /api/me', () => {
  it('401s without a session', async () => {
    const res = await mePATCH(authedReq('http://localhost/api/me', null, { method: 'PATCH', body: JSON.stringify({}) }));
    expect(res.status).toBe(401);
  });

  it('updates the display name', async () => {
    const id = await makeAccount();
    const res = await mePATCH(
      authedReq('http://localhost/api/me', id, { method: 'PATCH', body: JSON.stringify({ full_name: 'Sarah Connor' }) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.full_name).toBe('Sarah Connor');
  });
});

describe('DELETE /api/me', () => {
  it('401s without a session', async () => {
    const res = await meDELETE(authedReq('http://localhost/api/me', null, { method: 'DELETE' }));
    expect(res.status).toBe(401);
  });

  it('soft-deletes the account and clears the session cookie', async () => {
    const id = await makeAccount();
    const res = await meDELETE(authedReq('http://localhost/api/me', id, { method: 'DELETE' }));
    expect(res.status).toBe(202);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(new RegExp(`${SESSION_COOKIE}=;|Max-Age=0`, 'i'));

    const { rows } = await q.query<{ deleted_at: string | null }>(`SELECT deleted_at FROM users WHERE id = $1`, [id]);
    expect(rows[0].deleted_at).not.toBeNull();
  });
});

describe('POST /api/me/password', () => {
  it('401s without a session', async () => {
    const res = await passwordPOST(
      authedReq('http://localhost/api/me/password', null, {
        method: 'POST',
        body: JSON.stringify({ current_password: 'a', new_password: 'brandnewpass' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('400s missing fields', async () => {
    const id = await makeAccount();
    const res = await passwordPOST(
      authedReq('http://localhost/api/me/password', id, { method: 'POST', body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
  });

  it('403s a wrong current password', async () => {
    const id = await makeAccount();
    const res = await passwordPOST(
      authedReq('http://localhost/api/me/password', id, {
        method: 'POST',
        body: JSON.stringify({ current_password: 'wrong', new_password: 'brandnewpass' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('changes the password and re-issues a fresh session cookie for the current device', async () => {
    const id = await makeAccount();
    const res = await passwordPOST(
      authedReq('http://localhost/api/me/password', id, {
        method: 'POST',
        body: JSON.stringify({ current_password: 'originalpass', new_password: 'brandnewpass' }),
      }),
    );
    expect(res.status).toBe(204);
    const setCookie = res.headers.get('set-cookie') ?? '';
    const token = setCookie.split(`${SESSION_COOKIE}=`)[1]?.split(';')[0];
    expect(verifySession(token)?.uid).toBe(id);

    expect(await userRepo.verifyCredentials(q, (await userRepo.getAccount(q, id)).email, 'brandnewpass')).not.toBeNull();
  });
});
