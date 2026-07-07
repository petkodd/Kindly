import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { referralRepo } from '../src/lib/repos/referral';
import { auditRepo } from '../src/lib/repos/audit';
import { purgeHardDeletes } from '../src/lib/jobs/purge';

let q: Querier;

const NOW = new Date('2026-07-06T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

async function makeUser(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function softDeleteUser(id: string, at: Date): Promise<void> {
  await q.query(`UPDATE users SET deleted_at = $2 WHERE id = $1`, [id, at]);
}

async function count(table: string): Promise<number> {
  const { rows } = await q.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

beforeEach(() => {
  q = makeTestDb();
});

describe('purgeHardDeletes', () => {
  it('purges a user soft-deleted past the window, cascading their whole tree', async () => {
    const buyer = await makeUser('gone@example.com');
    const parent = await parentRepo.create(q, {
      buyerId: buyer,
      firstName: 'Robert',
      relationship: 'father',
    });
    // Seed the subtree: memory, conversation + transcript turn.
    await q.query(
      `INSERT INTO memories (parent_id, layer, mem_key, mem_value, source, status)
       VALUES ($1, 'core', 'hometown', 'Detroit', 'onboarding', 'confirmed')`,
      [parent.id],
    );
    const { rows: convRows } = await q.query<{ id: string }>(
      `INSERT INTO conversations (parent_id) VALUES ($1) RETURNING id`,
      [parent.id],
    );
    await q.query(
      `INSERT INTO conversation_turns (conversation_id, role, content)
       VALUES ($1, 'parent', 'hello')`,
      [convRows[0].id],
    );

    await softDeleteUser(buyer, daysAgo(31));
    const result = await purgeHardDeletes(q, { now: NOW });

    expect(result.purgedUsers).toBe(1);
    expect(await count('users')).toBe(0);
    expect(await count('parents')).toBe(0);
    expect(await count('memories')).toBe(0);
    expect(await count('conversations')).toBe(0);
    expect(await count('conversation_turns')).toBe(0);
  });

  it('keeps a user inside the retention window', async () => {
    const buyer = await makeUser('recent@example.com');
    await softDeleteUser(buyer, daysAgo(5));
    const result = await purgeHardDeletes(q, { now: NOW });
    expect(result.purgedUsers).toBe(0);
    expect(await count('users')).toBe(1);
  });

  it('anonymizes non-cascading references instead of failing the delete', async () => {
    // Referrer stays; the redeemer is purged. referrals.redeemed_by has no
    // ON DELETE action, so without the nullification the DELETE would violate
    // the FK. The referral row must survive with the identity link removed.
    const referrer = await makeUser('referrer@example.com');
    const redeemer = await makeUser('redeemer@example.com');
    const referral = await referralRepo.generate(q, referrer);
    await referralRepo.redeem(q, referral.code, { redeemerId: redeemer, householdHash: 'hh-1' });
    // An audit row written by the purged user (e.g. as an admin).
    await auditRepo.log(q, { actorId: redeemer, action: 'x', targetType: 'y' });

    await softDeleteUser(redeemer, daysAgo(31));
    const result = await purgeHardDeletes(q, { now: NOW });

    expect(result.purgedUsers).toBe(1);
    expect(await count('users')).toBe(1); // referrer survives
    const { rows: refRows } = await q.query<{ redeemed_by: string | null }>(
      `SELECT redeemed_by FROM referrals WHERE id = $1`,
      [referral.id],
    );
    expect(refRows[0].redeemed_by).toBeNull();
    const { rows: auditRows } = await q.query<{ actor_id: string | null }>(
      `SELECT actor_id FROM audit_log`,
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actor_id).toBeNull();
  });

  it('purges a soft-deleted parent whose buyer is alive, leaving siblings intact', async () => {
    const buyer = await makeUser('alive@example.com');
    const gone = await parentRepo.create(q, {
      buyerId: buyer,
      firstName: 'Robert',
      relationship: 'father',
    });
    const kept = await parentRepo.create(q, {
      buyerId: buyer,
      firstName: 'Nadia',
      relationship: 'mother',
    });
    await q.query(`INSERT INTO conversations (parent_id) VALUES ($1)`, [gone.id]);
    await q.query(`UPDATE parents SET deleted_at = $2 WHERE id = $1`, [gone.id, daysAgo(31)]);

    const result = await purgeHardDeletes(q, { now: NOW });

    expect(result.purgedUsers).toBe(0);
    expect(result.purgedParents).toBe(1);
    expect(await count('conversations')).toBe(0); // transcript subtree purged
    const { rows } = await q.query<{ id: string }>(`SELECT id FROM parents`);
    expect(rows.map((r) => r.id)).toEqual([kept.id]);
  });

  it('keeps a recently soft-deleted parent (still recoverable)', async () => {
    const buyer = await makeUser('alive2@example.com');
    const parent = await parentRepo.create(q, {
      buyerId: buyer,
      firstName: 'Robert',
      relationship: 'father',
    });
    await q.query(`UPDATE parents SET deleted_at = $2 WHERE id = $1`, [parent.id, daysAgo(2)]);
    const result = await purgeHardDeletes(q, { now: NOW });
    expect(result.purgedParents).toBe(0);
    expect(await count('parents')).toBe(1);
  });

  it('purges only turns whose retention_purge_at has passed', async () => {
    const buyer = await makeUser('alive3@example.com');
    const parent = await parentRepo.create(q, {
      buyerId: buyer,
      firstName: 'Robert',
      relationship: 'father',
    });
    const { rows: convRows } = await q.query<{ id: string }>(
      `INSERT INTO conversations (parent_id) VALUES ($1) RETURNING id`,
      [parent.id],
    );
    await q.query(
      `INSERT INTO conversation_turns (conversation_id, role, content, retention_purge_at)
       VALUES ($1, 'parent', 'expired', $2),
              ($1, 'kindly', 'not yet', $3),
              ($1, 'parent', 'no stamp', NULL)`,
      [convRows[0].id, daysAgo(1), daysAgo(-1)],
    );

    const result = await purgeHardDeletes(q, { now: NOW });

    expect(result.purgedTurns).toBe(1);
    const { rows } = await q.query<{ content: string }>(
      `SELECT content FROM conversation_turns ORDER BY content`,
    );
    expect(rows.map((r) => r.content).sort()).toEqual(['no stamp', 'not yet']);
  });

  it('anonymizes analytics events (no FK — they would silently outlive the purge)', async () => {
    const gone = await makeUser('tracked@example.com');
    const alive = await makeUser('still-here@example.com');
    // The purged buyer's parent was never individually soft-deleted — it goes
    // via the user cascade, so its analytics ref must still be anonymized.
    const parent = await parentRepo.create(q, {
      buyerId: gone,
      firstName: 'Robert',
      relationship: 'father',
    });
    await q.query(
      `INSERT INTO analytics_events (event_name, user_id, parent_id)
       VALUES ('talk_session_started', $1, $2), ('signup', $3, NULL)`,
      [gone, parent.id, alive],
    );

    await softDeleteUser(gone, daysAgo(31));
    await purgeHardDeletes(q, { now: NOW });

    const { rows } = await q.query<{ event_name: string; user_id: string | null; parent_id: string | null }>(
      `SELECT event_name, user_id, parent_id FROM analytics_events ORDER BY event_name`,
    );
    expect(rows).toHaveLength(2);
    const started = rows.find((r) => r.event_name === 'talk_session_started')!;
    expect(started.user_id).toBeNull();
    expect(started.parent_id).toBeNull();
    // The live user's event keeps its identity link.
    expect(rows.find((r) => r.event_name === 'signup')!.user_id).toBe(alive);
  });

  it('purges waitlist signups past the marketing retention window, keeping recent ones', async () => {
    await q.query(
      `INSERT INTO waitlist_signups (email, created_at)
       VALUES ('old@example.com', $1), ('recent@example.com', $2)`,
      [daysAgo(366), daysAgo(30)],
    );

    const result = await purgeHardDeletes(q, { now: NOW });

    expect(result.purgedWaitlistSignups).toBe(1);
    const { rows } = await q.query<{ email: string }>(`SELECT email FROM waitlist_signups`);
    expect(rows.map((r) => r.email)).toEqual(['recent@example.com']);
  });

  it('honors a custom waitlistRetentionDays', async () => {
    await q.query(
      `INSERT INTO waitlist_signups (email, created_at) VALUES ('week-old@example.com', $1)`,
      [daysAgo(8)],
    );
    const result = await purgeHardDeletes(q, { now: NOW, waitlistRetentionDays: 7 });
    expect(result.purgedWaitlistSignups).toBe(1);
    expect(await count('waitlist_signups')).toBe(0);
  });

  it('is a no-op on a clean database', async () => {
    const result = await purgeHardDeletes(q, { now: NOW });
    expect(result).toMatchObject({
      purgedUsers: 0,
      purgedParents: 0,
      purgedTurns: 0,
      purgedWaitlistSignups: 0,
    });
  });
});
