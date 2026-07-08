import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { analyticsEventRepo } from '../src/lib/repos/analyticsEvent';

let q: Querier;

beforeEach(() => {
  q = makeTestDb();
});

describe('analyticsEventRepo.record', () => {
  it('inserts an event with no user/parent and no props', async () => {
    await analyticsEventRepo.record(q, 'page_viewed');

    const { rows } = await q.query<{ event_name: string; user_id: string | null; props: unknown }>(
      `SELECT event_name, user_id, props FROM analytics_events WHERE event_name = 'page_viewed'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBeNull();
  });

  it('stores props as JSON and links user/parent ids when given', async () => {
    const { rows: users } = await q.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      ['sarah@example.com'],
    );
    const userId = users[0].id;

    await analyticsEventRepo.record(q, 'cta_clicked', { cta_id: 'hero_primary', slug: '/' }, { userId });

    const { rows } = await q.query<{ user_id: string; props: { cta_id: string } }>(
      `SELECT user_id, props FROM analytics_events WHERE event_name = 'cta_clicked'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(userId);
    expect(rows[0].props.cta_id).toBe('hero_primary');
  });
});
