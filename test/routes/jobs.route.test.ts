import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { consentRepo } from '../../src/lib/repos/consent';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { GET as weeklySummaryGET } from '../../src/app/api/jobs/generate-weekly-summary/route';
import { GET as purgeGET } from '../../src/app/api/jobs/purge-hard-deletes/route';

function cronReq(url: string, secret: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (secret !== null) headers.authorization = `Bearer ${secret}`;
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  q = makeTestDb();
  process.env.CRON_SECRET = 'cron-secret-123';
});

describe('GET /api/jobs/generate-weekly-summary', () => {
  it('401s without the cron secret', async () => {
    const res = await weeklySummaryGET(cronReq('http://localhost/api/jobs/generate-weekly-summary', null));
    expect(res.status).toBe(401);
  });

  it('401s a wrong cron secret', async () => {
    const res = await weeklySummaryGET(cronReq('http://localhost/api/jobs/generate-weekly-summary', 'wrong'));
    expect(res.status).toBe(401);
  });

  it('runs the job and returns a result summary given the correct secret', async () => {
    const buyer = await (async () => {
      const { rows } = await q.query<{ id: string }>(`INSERT INTO users (email) VALUES ('sarah@example.com') RETURNING id`);
      return rows[0].id;
    })();
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    await consentRepo.record(q, { parentId: parent.id, kind: 'buyer_attestation', grantedBy: buyer });
    await parentRepo.activate(q, parent.id, buyer);

    const res = await weeklySummaryGET(cronReq('http://localhost/api/jobs/generate-weekly-summary', 'cron-secret-123'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.processed).toBe('number');
  });
});

describe('GET /api/jobs/purge-hard-deletes', () => {
  it('401s without the cron secret', async () => {
    const res = await purgeGET(cronReq('http://localhost/api/jobs/purge-hard-deletes', null));
    expect(res.status).toBe(401);
  });

  it('401s a wrong cron secret', async () => {
    const res = await purgeGET(cronReq('http://localhost/api/jobs/purge-hard-deletes', 'wrong'));
    expect(res.status).toBe(401);
  });

  it('runs the job and returns purge counts given the correct secret', async () => {
    const res = await purgeGET(cronReq('http://localhost/api/jobs/purge-hard-deletes', 'cron-secret-123'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body).toMatchObject({ purgedUsers: 0, purgedParents: 0, purgedTurns: 0 });
  });
});
