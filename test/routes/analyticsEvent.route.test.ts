import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handler picks up the mocked db().
import { POST as analyticsEventPOST } from '../../src/app/api/analytics/event/route';

function postReq(url: string, body?: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  q = makeTestDb();
  process.env.DATABASE_URL = 'postgres://test';
});

describe('POST /api/analytics/event', () => {
  it('accepts page_viewed and persists it', async () => {
    const res = await analyticsEventPOST(
      postReq('http://localhost/api/analytics/event', { event_name: 'page_viewed', props: { slug: '/pricing' } }),
    );
    expect(res.status).toBe(202);
    const bodyJson = await res.json();
    expect(bodyJson.persisted).toBe(true);

    const { rows } = await q.query<{ props: { slug: string } }>(
      `SELECT props FROM analytics_events WHERE event_name = 'page_viewed'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].props.slug).toBe('/pricing');
  });

  it('accepts cta_clicked and persists it', async () => {
    const res = await analyticsEventPOST(
      postReq('http://localhost/api/analytics/event', {
        event_name: 'cta_clicked',
        props: { cta_id: 'hero_primary', slug: '/' },
      }),
    );
    expect(res.status).toBe(202);
    const { rows } = await q.query(`SELECT * FROM analytics_events WHERE event_name = 'cta_clicked'`);
    expect(rows).toHaveLength(1);
  });

  it('rejects an event name outside the client allow-list', async () => {
    const res = await analyticsEventPOST(
      postReq('http://localhost/api/analytics/event', { event_name: 'subscription_started' }),
    );
    expect(res.status).toBe(400);
    const { rows } = await q.query(`SELECT * FROM analytics_events`);
    expect(rows).toHaveLength(0);
  });

  it('strips non-scalar / oversized prop values instead of storing them', async () => {
    await analyticsEventPOST(
      postReq('http://localhost/api/analytics/event', {
        event_name: 'page_viewed',
        props: { slug: '/', nested: { a: 1 }, huge: 'x'.repeat(500), ok: 'kept' },
      }),
    );
    const { rows } = await q.query<{ props: Record<string, unknown> }>(
      `SELECT props FROM analytics_events WHERE event_name = 'page_viewed'`,
    );
    expect(rows[0].props.nested).toBeUndefined();
    expect(rows[0].props.huge).toBeUndefined();
    expect(rows[0].props.ok).toBe('kept');
  });

  it('honors Do-Not-Track by not persisting anything', async () => {
    const res = await analyticsEventPOST(
      postReq('http://localhost/api/analytics/event', { event_name: 'page_viewed' }, { dnt: '1' }),
    );
    expect(res.status).toBe(202);
    const bodyJson = await res.json();
    expect(bodyJson.persisted).toBe(false);
    const { rows } = await q.query(`SELECT * FROM analytics_events`);
    expect(rows).toHaveLength(0);
  });

  it('degrades quietly when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const res = await analyticsEventPOST(
      postReq('http://localhost/api/analytics/event', { event_name: 'page_viewed' }),
    );
    expect(res.status).toBe(202);
    const bodyJson = await res.json();
    expect(bodyJson.persisted).toBe(false);
  });

  it('400s on malformed JSON', async () => {
    const req = new NextRequest('http://localhost/api/analytics/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await analyticsEventPOST(req);
    expect(res.status).toBe(400);
  });
});
