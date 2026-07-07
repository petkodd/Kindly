import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { waitlistRepo } from '../src/lib/repos/waitlist';

let q: Querier;

beforeEach(() => {
  q = makeTestDb();
});

describe('waitlistRepo.signup', () => {
  it('inserts a signup and emits waitlist_joined', async () => {
    await waitlistRepo.signup(q, { email: 'alice@example.com', sourcePage: '/waitlist' });

    const { rows: signups } = await q.query<{ email: string; wants_demo: boolean }>(
      `SELECT email, wants_demo FROM waitlist_signups WHERE email = $1`,
      ['alice@example.com'],
    );
    expect(signups).toHaveLength(1);
    expect(signups[0].wants_demo).toBe(false);

    const { rows: events } = await q.query<{ event_name: string }>(
      `SELECT event_name FROM analytics_events WHERE event_name = 'waitlist_joined'`,
    );
    expect(events).toHaveLength(1);
  });

  it('deduplicates by email (ON CONFLICT DO NOTHING)', async () => {
    await waitlistRepo.signup(q, { email: 'alice@example.com' });
    await waitlistRepo.signup(q, { email: 'alice@example.com' });

    const { rows } = await q.query(
      `SELECT count(*)::int AS n FROM waitlist_signups WHERE email = 'alice@example.com'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('stores wants_demo = true when passed', async () => {
    await waitlistRepo.signup(q, { email: 'bob@example.com', wantsDemo: true });

    const { rows } = await q.query<{ wants_demo: boolean }>(
      `SELECT wants_demo FROM waitlist_signups WHERE email = $1`,
      ['bob@example.com'],
    );
    expect(rows[0].wants_demo).toBe(true);
  });
});

describe('waitlistRepo.requestDemo', () => {
  it('inserts a new signup with wants_demo = true', async () => {
    await waitlistRepo.requestDemo(q, { email: 'carol@example.com', sourcePage: '/demo' });

    const { rows } = await q.query<{ wants_demo: boolean }>(
      `SELECT wants_demo FROM waitlist_signups WHERE email = $1`,
      ['carol@example.com'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].wants_demo).toBe(true);
  });

  it('flips wants_demo to true on an existing signup', async () => {
    await waitlistRepo.signup(q, { email: 'dave@example.com', wantsDemo: false });
    await waitlistRepo.requestDemo(q, { email: 'dave@example.com' });

    const { rows } = await q.query<{ wants_demo: boolean; count: number }>(
      `SELECT wants_demo, count(*)::int AS count FROM waitlist_signups WHERE email = $1 GROUP BY wants_demo`,
      ['dave@example.com'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].wants_demo).toBe(true);
  });

  it('emits demo_requested analytics event', async () => {
    await waitlistRepo.requestDemo(q, { email: 'eve@example.com' });

    const { rows } = await q.query<{ event_name: string }>(
      `SELECT event_name FROM analytics_events WHERE event_name = 'demo_requested'`,
    );
    expect(rows).toHaveLength(1);
  });
});
