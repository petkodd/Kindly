import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handler picks up the mocked db().
import { POST as signupPOST } from '../../src/app/api/auth/signup/route';

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
});

describe('POST /api/auth/signup', () => {
  it('creates an account and emits an account_created analytics event', async () => {
    const req = new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'sarah@example.com', password: 'correct-horse' }),
    });
    const res = await signupPOST(req);
    expect(res.status).toBe(201);
    const body = await res.json();

    const { rows } = await q.query<{ event_name: string; user_id: string; props: { method: string } }>(
      `SELECT event_name, user_id, props FROM analytics_events WHERE event_name = 'account_created'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(body.user.id);
    expect(rows[0].props.method).toBe('password');
  });
});
