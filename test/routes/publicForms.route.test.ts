import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { POST as waitlistPOST } from '../../src/app/api/waitlist/route';
import { POST as demoPOST } from '../../src/app/api/demo/route';

function postReq(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  q = makeTestDb();
});

describe('POST /api/waitlist', () => {
  it('400s an invalid email', async () => {
    process.env.DATABASE_URL = 'postgres://test';
    const res = await waitlistPOST(postReq('http://localhost/api/waitlist', { email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('400s malformed JSON', async () => {
    process.env.DATABASE_URL = 'postgres://test';
    const req = new NextRequest('http://localhost/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await waitlistPOST(req);
    expect(res.status).toBe(400);
  });

  it('degrades to persisted:false when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const res = await waitlistPOST(postReq('http://localhost/api/waitlist', { email: 'alice@example.com' }));
    expect(res.status).toBe(201);
    expect((await res.json()).persisted).toBe(false);
  });

  it('persists a signup when DATABASE_URL is set', async () => {
    process.env.DATABASE_URL = 'postgres://test';
    const res = await waitlistPOST(postReq('http://localhost/api/waitlist', { email: 'alice@example.com', source_page: '/waitlist' }));
    expect(res.status).toBe(201);
    expect((await res.json()).persisted).toBe(true);

    const { rows } = await q.query(`SELECT email FROM waitlist_signups WHERE email = 'alice@example.com'`);
    expect(rows).toHaveLength(1);
  });
});

describe('POST /api/demo', () => {
  it('400s an invalid email', async () => {
    process.env.DATABASE_URL = 'postgres://test';
    const res = await demoPOST(postReq('http://localhost/api/demo', { email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('degrades to persisted:false when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const res = await demoPOST(postReq('http://localhost/api/demo', { email: 'bob@example.com' }));
    expect(res.status).toBe(201);
    expect((await res.json()).persisted).toBe(false);
  });

  it('persists a signup with wants_demo = true when DATABASE_URL is set', async () => {
    process.env.DATABASE_URL = 'postgres://test';
    const res = await demoPOST(postReq('http://localhost/api/demo', { email: 'bob@example.com' }));
    expect(res.status).toBe(201);
    expect((await res.json()).persisted).toBe(true);

    const { rows } = await q.query<{ wants_demo: boolean }>(`SELECT wants_demo FROM waitlist_signups WHERE email = 'bob@example.com'`);
    expect(rows[0].wants_demo).toBe(true);
  });
});
