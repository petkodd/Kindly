import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { safetyFlagRepo } from '../../src/lib/repos/safetyFlag';
import { userRepo } from '../../src/lib/repos/user';
import { signSession, SESSION_COOKIE } from '../../src/lib/session';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { GET as overviewGET } from '../../src/app/api/admin/overview/route';
import { GET as flagsGET } from '../../src/app/api/admin/flags/route';
import { PATCH as flagPATCH } from '../../src/app/api/admin/flags/[fid]/route';

async function makeAdmin(): Promise<string> {
  const user = await userRepo.create(q, { email: `admin${Math.random()}@example.com`, password: 'originalpass' });
  await q.query(`UPDATE users SET is_admin = true WHERE id = $1`, [user.id]);
  return user.id;
}

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

function adminReq(url: string, adminId: string | null, init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (adminId) headers.cookie = `${SESSION_COOKIE}=${signSession(adminId, { isAdmin: true })}`;
  return new NextRequest(url, { ...init, headers });
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
});

describe('GET /api/admin/overview', () => {
  it('401s without an admin session', async () => {
    const res = await overviewGET(adminReq('http://localhost/api/admin/overview', null));
    expect(res.status).toBe(401);
  });

  it('401s a buyer session that is not admin', async () => {
    const buyer = await makeBuyer('sarah@example.com');
    const req = new NextRequest('http://localhost/api/admin/overview', {
      headers: { cookie: `${SESSION_COOKIE}=${signSession(buyer, { isAdmin: false })}` },
    });
    const res = await overviewGET(req);
    expect(res.status).toBe(401);
  });

  it('returns overview metrics and audit-logs the view', async () => {
    const admin = await makeAdmin();
    const res = await overviewGET(adminReq('http://localhost/api/admin/overview', admin));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overview).toMatchObject({ buyers: expect.any(Number) });

    const { rows } = await q.query(`SELECT action FROM audit_log WHERE action = 'view_overview'`);
    expect(rows).toHaveLength(1);
  });
});

describe('GET /api/admin/flags', () => {
  it('401s without an admin session', async () => {
    const res = await flagsGET(adminReq('http://localhost/api/admin/flags', null));
    expect(res.status).toBe(401);
  });

  it('returns the open/reviewing queue, audit-logged', async () => {
    const admin = await makeAdmin();
    const buyer = await makeBuyer('sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    await safetyFlagRepo.record(q, { parentId: parent.id, severity: 'p2', detail: 'seemed low' });

    const res = await flagsGET(adminReq('http://localhost/api/admin/flags', admin));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flags).toHaveLength(1);

    const { rows } = await q.query(`SELECT action FROM audit_log WHERE action = 'view_flags'`);
    expect(rows).toHaveLength(1);
  });
});

describe('PATCH /api/admin/flags/:fid', () => {
  it('401s without an admin session', async () => {
    const res = await flagPATCH(
      adminReq('http://localhost/api/admin/flags/x', null, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) }),
      { params: { fid: 'x' } },
    );
    expect(res.status).toBe(401);
  });

  it('400s a missing status', async () => {
    const admin = await makeAdmin();
    const res = await flagPATCH(
      adminReq('http://localhost/api/admin/flags/x', admin, { method: 'PATCH', body: JSON.stringify({}) }),
      { params: { fid: 'x' } },
    );
    expect(res.status).toBe(400);
  });

  it('404s an unknown flag id', async () => {
    const admin = await makeAdmin();
    const res = await flagPATCH(
      adminReq('http://localhost/api/admin/flags/00000000-0000-0000-0000-000000000000', admin, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved' }),
      }),
      { params: { fid: '00000000-0000-0000-0000-000000000000' } },
    );
    expect(res.status).toBe(404);
  });

  it('updates status, stamps resolved_by/resolved_at, and audit-logs it', async () => {
    const admin = await makeAdmin();
    const buyer = await makeBuyer('sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const flag = await safetyFlagRepo.record(q, { parentId: parent.id, severity: 'p2', detail: 'seemed low' });

    const res = await flagPATCH(
      adminReq(`http://localhost/api/admin/flags/${flag.id}`, admin, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved' }),
      }),
      { params: { fid: flag.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flag.status).toBe('resolved');
    expect(body.flag.resolved_by).toBe(admin);
    expect(body.flag.resolved_at).toBeTruthy();

    const { rows } = await q.query(`SELECT action, target_id FROM audit_log WHERE action = 'update_flag'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].target_id).toBe(flag.id);
  });
});
