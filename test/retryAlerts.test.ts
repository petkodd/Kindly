import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import type { Parent } from '../src/lib/types';
import { parentRepo } from '../src/lib/repos/parent';
import { safetyFlagRepo } from '../src/lib/repos/safetyFlag';
import { fakeEmailClient } from '../src/lib/email/fake';
import { dispatchSafetyAlert } from '../src/lib/safety/alerts';
import { retryUndeliveredAlerts, MAX_ALERT_ATTEMPTS } from '../src/lib/jobs/retryAlerts';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));
import { GET as endIdleGET } from '../src/app/api/jobs/end-idle-sessions/route';
import { NextRequest } from 'next/server';

const BUYER = 'sarah@example.com';
const t0 = new Date('2026-10-20T10:00:00Z');
const hours = (h: number) => new Date(t0.getTime() + h * 3_600_000);

async function setup(relationship: 'mother' | 'self' = 'mother') {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email, full_name) VALUES ($1, 'Sarah Miller') RETURNING id`,
    [BUYER],
  );
  return parentRepo.create(q, { buyerId: rows[0].id, firstName: 'Ruth', relationship });
}

async function failedFlag(parent: Parent, severity: 'p0' | 'p1' | 'p2' = 'p0', at = t0) {
  const flag = await safetyFlagRepo.record(q, { parentId: parent.id, severity, detail: 'test' });
  await q.query(`UPDATE safety_flags SET created_at = $2 WHERE id = $1`, [flag.id, at]);
  return flag;
}

const familySends = () =>
  vi.mocked(fakeEmailClient.send).mock.calls.filter((c) => (c[0] as { to: string }).to === BUYER).length;

beforeEach(() => {
  q = makeTestDb();
  process.env.ADMIN_ALERT_EMAIL = 'safety-team@example.com';
  vi.spyOn(fakeEmailClient, 'send').mockResolvedValue({ id: 'provider-email' });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_ALERT_EMAIL;
  delete process.env.CRON_SECRET;
});

describe('retryUndeliveredAlerts (release check NEW-3)', () => {
  it('re-sends an undelivered P0 and marks it notified', async () => {
    const parent = await setup();
    vi.mocked(fakeEmailClient.send).mockRejectedValueOnce(new Error('provider down'));
    const flag = await failedFlag(parent);
    await dispatchSafetyAlert(q, { flag, parent, now: t0 });
    expect((await q.query(`SELECT notified_at FROM safety_flags WHERE id = $1`, [flag.id])).rows[0].notified_at).toBeNull();

    const result = await retryUndeliveredAlerts(q, { now: hours(6) });
    expect(result).toEqual({ retried: 1, delivered: 1, failed: 0 });
    const stored = (await q.query(`SELECT notified_at, alert_attempts FROM safety_flags WHERE id = $1`, [flag.id])).rows[0];
    expect(stored.notified_at).not.toBeNull();
    expect(stored.alert_attempts).toBe(2);

    // Delivered now: nothing more to retry.
    expect((await retryUndeliveredAlerts(q, { now: hours(7) })).retried).toBe(0);
  });

  it(`stops after ${MAX_ALERT_ATTEMPTS} attempts in total`, async () => {
    const parent = await setup();
    vi.mocked(fakeEmailClient.send).mockImplementation(async (input) => {
      if ((input as { to: string }).to === BUYER) throw new Error('provider down');
      return { id: 'ok' };
    });
    const flag = await failedFlag(parent);
    await dispatchSafetyAlert(q, { flag, parent, now: t0 });
    expect((await retryUndeliveredAlerts(q, { now: hours(1) })).retried).toBe(1);
    expect((await retryUndeliveredAlerts(q, { now: hours(2) })).retried).toBe(1);
    expect((await retryUndeliveredAlerts(q, { now: hours(3) })).retried).toBe(0);
    expect(familySends()).toBe(MAX_ALERT_ATTEMPTS);
  });

  it('skips throttled flags, P2, old flags, resolved flags and self-use parents', async () => {
    const parent = await setup();
    // Delivered first alert, then a throttled one.
    await dispatchSafetyAlert(q, { flag: await failedFlag(parent), parent, now: t0 });
    const throttled = await failedFlag(parent);
    expect((await dispatchSafetyAlert(q, { flag: throttled, parent, now: hours(0.1) }))?.throttled).toBe(true);
    await failedFlag(parent, 'p2');
    await failedFlag(parent, 'p0', hours(-30)); // older than the window
    const resolved = await failedFlag(parent);
    await q.query(`UPDATE safety_flags SET status = 'resolved' WHERE id = $1`, [resolved.id]);

    const { rows } = await q.query<{ id: string }>(`INSERT INTO users (email) VALUES ('self@example.com') RETURNING id`);
    const self = await parentRepo.create(q, { buyerId: rows[0].id, firstName: 'Al', relationship: 'self' });
    await failedFlag(self);

    vi.mocked(fakeEmailClient.send).mockClear();
    expect(await retryUndeliveredAlerts(q, { now: hours(1) })).toEqual({ retried: 0, delivered: 0, failed: 0 });
    expect(fakeEmailClient.send).not.toHaveBeenCalled();
  });

  it('runs from the daily end-idle-sessions cron (no new sub-daily cron)', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    const parent = await setup();
    await failedFlag(parent, 'p1', new Date(Date.now() - 3_600_000));
    const res = await endIdleGET(
      new NextRequest('http://localhost/api/jobs/end-idle-sessions', { headers: { authorization: 'Bearer test-cron-secret' } }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).alerts).toMatchObject({ retried: 1, delivered: 1 });
    expect(familySends()).toBe(1);
  });
});
