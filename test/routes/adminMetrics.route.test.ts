import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { userRepo } from '../../src/lib/repos/user';
import { parentRepo } from '../../src/lib/repos/parent';
import { signSession, SESSION_COOKIE } from '../../src/lib/session';
import { makeBuyer, authedReq } from './helpers';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handler picks up the mocked db().
import { GET as metricsGET } from '../../src/app/api/admin/metrics/route';

async function makeAdmin(): Promise<string> {
  const user = await userRepo.create(q, { email: `admin${Math.random()}@example.com`, password: 'originalpass' });
  await q.query(`UPDATE users SET is_admin = true WHERE id = $1`, [user.id]);
  return user.id;
}

function adminReq(url: string, adminId: string | null, init?: Parameters<typeof authedReq>[2]) {
  return authedReq(url, adminId, init, { isAdmin: true });
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
});

describe('GET /api/admin/metrics', () => {
  it('401s without an admin session', async () => {
    const res = await metricsGET(adminReq('http://localhost/api/admin/metrics', null));
    expect(res.status).toBe(401);
  });

  it('401s a buyer session that is not admin', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const req = new NextRequest('http://localhost/api/admin/metrics', {
      headers: { cookie: `${SESSION_COOKIE}=${signSession(buyer, { isAdmin: false })}` },
    });
    const res = await metricsGET(req);
    expect(res.status).toBe(401);
  });

  it('returns retention + cost_buckets (aggregate-only) and audit-logs the view, defaulting to daily granularity', async () => {
    const admin = await makeAdmin();
    const res = await metricsGET(adminReq('http://localhost/api/admin/metrics', admin));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.granularity).toBe('day');
    expect(body.retention).toMatchObject({
      w1: { eligible: expect.any(Number), retained: expect.any(Number) },
      w2: { eligible: expect.any(Number), retained: expect.any(Number) },
      w4: { eligible: expect.any(Number), retained: expect.any(Number) },
    });
    expect(Array.isArray(body.cost_buckets)).toBe(true);

    // Aggregate-only: no parent_id or content anywhere in the response.
    expect(JSON.stringify(body)).not.toMatch(/parent_id|content/);

    const { rows } = await q.query(`SELECT action, meta FROM audit_log WHERE action = 'view_metrics'`);
    expect(rows).toHaveLength(1);
  });

  it('honors ?granularity=week', async () => {
    const admin = await makeAdmin();
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    await q.query(`INSERT INTO conversations (parent_id, started_at) VALUES ($1, now())`, [parent.id]);

    const dayRes = await metricsGET(adminReq('http://localhost/api/admin/metrics', admin));
    const dayBody = await dayRes.json();
    expect(dayBody.granularity).toBe('day');

    const weekRes = await metricsGET(adminReq('http://localhost/api/admin/metrics?granularity=week', admin));
    const weekBody = await weekRes.json();
    expect(weekBody.granularity).toBe('week');
    expect(weekBody.cost_buckets.length).toBeGreaterThan(0);
  });
});
