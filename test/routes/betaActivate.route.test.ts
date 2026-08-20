import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { betaInviteRepo } from '../../src/lib/repos/betaInvite';
import { makeBuyer, authedReq } from './helpers';

let q: Querier;
// Spread the actual module (not just { db }) so withTransaction's real
// implementation runs against the mocked pool — see src/lib/db.ts's note on
// pg-mem's BEGIN/COMMIT/ROLLBACK support for what this does and doesn't prove.
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, db: () => q };
});

// Imported AFTER the mock so the handler picks up the mocked db().
import { POST as activatePOST } from '../../src/app/api/billing/beta/activate/route';
import { subscriptionRepo } from '../../src/lib/repos/subscription';
import { auditRepo } from '../../src/lib/repos/audit';

function req(buyerId: string | null, body: unknown) {
  return authedReq('http://localhost/api/billing/beta/activate', buyerId, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
  process.env.FOUNDING_FAMILY_BETA_ENABLED = 'true';
  delete process.env.FOUNDING_FAMILY_BETA_DAYS;
  // Deliberately unset — proves the route never needs Stripe configured.
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_FAMILY_MONTHLY;
});

describe('POST /api/billing/beta/activate', () => {
  it('401s without a buyer session', async () => {
    const res = await activatePOST(req(null, { parent_id: 'x', invite_token: 'whatever' }));
    expect(res.status).toBe(401);
  });

  it('503s when the feature flag is not enabled', async () => {
    delete process.env.FOUNDING_FAMILY_BETA_ENABLED;
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token } = await betaInviteRepo.issue(q, { email: 'sarah@example.com', ttlDays: 14 });

    const res = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(res.status).toBe(503);
  });

  it('503s for any non-"true" value of the flag (e.g. "1")', async () => {
    process.env.FOUNDING_FAMILY_BETA_ENABLED = '1';
    const buyer = await makeBuyer(q, 'sarah2@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token } = await betaInviteRepo.issue(q, { email: 'sarah2@example.com', ttlDays: 14 });

    const res = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(res.status).toBe(503);
  });

  it('activates a valid invite: grants a beta subscription and never touches Stripe (unset STRIPE_SECRET_KEY)', async () => {
    const buyer = await makeBuyer(q, 'sarah3@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token } = await betaInviteRepo.issue(q, { email: 'sarah3@example.com', ttlDays: 14 });

    const res = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.already_active).toBe(false);

    const { rows } = await q.query(
      `SELECT status, stripe_customer_id, stripe_sub_id, current_period_end, created_at FROM subscriptions WHERE parent_id = $1`,
      [parent.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('beta');
    expect(rows[0].stripe_customer_id).toBeNull();
    expect(rows[0].stripe_sub_id).toBeNull();
  });

  it('calculates the beta duration from FOUNDING_FAMILY_BETA_DAYS', async () => {
    process.env.FOUNDING_FAMILY_BETA_DAYS = '30';
    const buyer = await makeBuyer(q, 'sarah4@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token } = await betaInviteRepo.issue(q, { email: 'sarah4@example.com', ttlDays: 30 });

    const before = Date.now();
    await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));

    const { rows } = await q.query<{ current_period_end: string }>(
      `SELECT current_period_end FROM subscriptions WHERE parent_id = $1`,
      [parent.id],
    );
    const endsAt = new Date(rows[0].current_period_end).getTime();
    expect(endsAt).toBeGreaterThan(before + 29 * 86400000);
    expect(endsAt).toBeLessThan(before + 31 * 86400000);
  });

  it('400s an unknown/garbage token', async () => {
    const buyer = await makeBuyer(q, 'sarah5@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });

    const res = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: 'not-a-real-token' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_invite');
  });

  it('400s an expired invite', async () => {
    const buyer = await makeBuyer(q, 'sarah6@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token, invite } = await betaInviteRepo.issue(q, { email: 'sarah6@example.com', ttlDays: 14 });
    await q.query(`UPDATE beta_invites SET expires_at = now() - interval '1 hour' WHERE id = $1`, [invite.id]);

    const res = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(res.status).toBe(400);
    const { rows } = await q.query(`SELECT count(*)::int AS n FROM subscriptions WHERE parent_id = $1`, [parent.id]);
    expect(rows[0].n).toBe(0);
  });

  it('400s a revoked invite', async () => {
    const buyer = await makeBuyer(q, 'sarah7@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token, invite } = await betaInviteRepo.issue(q, { email: 'sarah7@example.com', ttlDays: 14 });
    await betaInviteRepo.revoke(q, invite.id);

    const res = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(res.status).toBe(400);
  });

  it('400s an invite already redeemed by a different account', async () => {
    const buyer = await makeBuyer(q, 'sarah8@example.com');
    const otherBuyer = await makeBuyer(q, 'other8@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token, invite } = await betaInviteRepo.issue(q, { email: 'sarah8@example.com', ttlDays: 14 });
    await betaInviteRepo.markRedeemed(q, invite.id, otherBuyer);

    const res = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(res.status).toBe(400);
  });

  it('a redeemed invite cannot be reused for a second parent by the same buyer once already granted', async () => {
    const buyer = await makeBuyer(q, 'sarah9@example.com');
    const parentA = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const parentB = await parentRepo.create(q, { buyerId: buyer, firstName: 'Rosa', relationship: 'mother' });
    const { token } = await betaInviteRepo.issue(q, { email: 'sarah9@example.com', ttlDays: 14 });

    const first = await activatePOST(req(buyer, { parent_id: parentA.id, invite_token: token }));
    expect(first.status).toBe(200);

    const second = await activatePOST(req(buyer, { parent_id: parentB.id, invite_token: token }));
    expect(second.status).toBe(200); // idempotent replay of the invite, not an error
    const { rows } = await q.query(`SELECT count(*)::int AS n FROM subscriptions WHERE parent_id = $1`, [parentB.id]);
    expect(rows[0].n).toBe(0); // but no new entitlement for the second parent
  });

  it('400s when the authenticated user\'s email does not match the invite', async () => {
    const buyer = await makeBuyer(q, 'sarah10@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token } = await betaInviteRepo.issue(q, { email: 'someoneelse10@example.com', ttlDays: 14 });

    const res = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(res.status).toBe(400);
    const { rows } = await q.query(`SELECT count(*)::int AS n FROM subscriptions WHERE parent_id = $1`, [parent.id]);
    expect(rows[0].n).toBe(0);
  });

  it('a non-invited user (no invite row for their email at all) cannot activate', async () => {
    const buyer = await makeBuyer(q, 'nobody-invited@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    // A real invite exists, but for a completely different email.
    const { token } = await betaInviteRepo.issue(q, { email: 'invited-family@example.com', ttlDays: 14 });

    const res = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(res.status).toBe(400);
  });

  it('404s a parent owned by another buyer (isolation) — checked before the invite is touched', async () => {
    const owner = await makeBuyer(q, 'owner11@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker11@example.com');
    const { token } = await betaInviteRepo.issue(q, { email: 'attacker11@example.com', ttlDays: 14 });

    const res = await activatePOST(req(attacker, { parent_id: parent.id, invite_token: token }));
    expect(res.status).toBe(404);
  });

  it('preserves an existing active subscription instead of downgrading to beta', async () => {
    const buyer = await makeBuyer(q, 'sarah12@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    await q.query(
      `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, current_period_end)
       VALUES ($1, $2, 'family', 'active', now() + interval '30 days')`,
      [buyer, parent.id],
    );
    const { token } = await betaInviteRepo.issue(q, { email: 'sarah12@example.com', ttlDays: 14 });

    const res = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(res.status).toBe(200);
    expect((await res.json()).already_active).toBe(true);

    const { rows } = await q.query(`SELECT status FROM subscriptions WHERE parent_id = $1`, [parent.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('active'); // unchanged, not overwritten
  });

  it('parallel activation requests for the same invite create only one entitlement', async () => {
    const buyer = await makeBuyer(q, 'sarah13@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token } = await betaInviteRepo.issue(q, { email: 'sarah13@example.com', ttlDays: 14 });

    const [r1, r2] = await Promise.all([
      activatePOST(req(buyer, { parent_id: parent.id, invite_token: token })),
      activatePOST(req(buyer, { parent_id: parent.id, invite_token: token })),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);

    const { rows } = await q.query(`SELECT count(*)::int AS n FROM subscriptions WHERE parent_id = $1`, [parent.id]);
    expect(rows[0].n).toBe(1);
  });

  it('records an audit event with safe metadata and never the raw token', async () => {
    const buyer = await makeBuyer(q, 'sarah14@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token } = await betaInviteRepo.issue(q, { email: 'sarah14@example.com', ttlDays: 14 });

    await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));

    const { rows } = await q.query<{ action: string; actor_id: string; meta: unknown }>(
      `SELECT action, actor_id, meta FROM audit_log WHERE action = 'founding_family_beta.activated'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(buyer);
    const meta = typeof rows[0].meta === 'string' ? JSON.parse(rows[0].meta) : rows[0].meta;
    expect(meta.duration_days).toBe(14);
    expect(meta.invite_id).toBeTruthy();
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain(token);
  });

  it('429s once the per-user rate limit is exceeded', async () => {
    const buyer = await makeBuyer(q, 'sarah15@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });

    let last;
    for (let i = 0; i < 11; i++) {
      const { token } = await betaInviteRepo.issue(q, { email: 'sarah15@example.com', ttlDays: 14 });
      last = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    }
    expect(last!.status).toBe(429);
  });

  it('email match is case-insensitive (normalized on both sides)', async () => {
    const buyer = await makeBuyer(q, 'MixedCase@Example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token } = await betaInviteRepo.issue(q, { email: 'mixedcase@example.com', ttlDays: 14 });

    const res = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Atomicity / recovery: the invite-redeem, entitlement-grant, and audit-log
// writes all happen inside one withTransaction call (see the route and
// src/lib/db.ts). On real Postgres that gives true all-or-nothing atomicity —
// validated manually against a live Postgres instance, documented in
// docs/founding-family-beta.md, since pg-mem (used here) does not actually
// discard writes on ROLLBACK (see withTransaction's doc comment).
//
// What these tests DO prove, engine-independently: no failure at any point
// after the invite is marked redeemed can leave it in a state where a retry
// by the SAME caller either (a) errors as "invalid invite", or (b) creates a
// second/duplicate entitlement. That guarantee comes from
// subscriptionRepo.grantBeta's idempotency-first check (by beta_invite_id)
// plus the route's redeemed-by-me replay branch, independently of whether
// the underlying engine actually rolled back the failed attempt's writes.
//
// Failure injection makes the repo throw. The route correctly classifies an
// unexpected throw as a 500, and errorToResponse() logs it via
// console.error('Unhandled error', ...) + Sentry.captureException — right for
// production, but noisy in tests that trigger a 500 on purpose. The
// describe-scoped console.error spy below captures that log (and the two
// primary tests assert it was OUR injected failure, so it's verification, not
// blind suppression). It cannot mask a genuine unhandled promise REJECTION —
// those surface through Node's process-level events, which this never touches.
// ---------------------------------------------------------------------------
describe('POST /api/billing/beta/activate — atomicity and recovery', () => {
  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('entitlement creation fails after the invite is marked redeemed — retry recovers exactly one entitlement', async () => {
    const buyer = await makeBuyer(q, 'recover1@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token } = await betaInviteRepo.issue(q, { email: 'recover1@example.com', ttlDays: 14 });

    const spy = vi.spyOn(subscriptionRepo, 'grantBeta').mockImplementationOnce(() => { throw new Error('simulated grantBeta failure'); });

    const first = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(first.status).toBe(500);
    // The 500 is the injected failure, logged exactly once — not some other
    // unexpected error being silently swallowed by the console.error spy.
    expect(errorLog).toHaveBeenCalledWith('Unhandled error', expect.objectContaining({ message: 'simulated grantBeta failure' }));
    spy.mockRestore();

    const second = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(second.status).toBe(200);
    expect((await second.json()).ok).toBe(true);

    const { rows } = await q.query(`SELECT count(*)::int AS n FROM subscriptions WHERE parent_id = $1`, [parent.id]);
    expect(rows[0].n).toBe(1); // not zero (recovered), not two (no duplicate)

    const finalInvite = await betaInviteRepo.findByToken(q, token);
    expect(finalInvite?.status).toBe('redeemed');
    expect(finalInvite?.redeemed_by_user_id).toBe(buyer);
  });

  it('audit-log write fails after the entitlement is granted — retry recovers exactly one entitlement and one audit row', async () => {
    const buyer = await makeBuyer(q, 'recover2@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token } = await betaInviteRepo.issue(q, { email: 'recover2@example.com', ttlDays: 14 });

    const spy = vi.spyOn(auditRepo, 'log').mockImplementationOnce(() => { throw new Error('simulated audit-log failure'); });

    const first = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(first.status).toBe(500);
    expect(errorLog).toHaveBeenCalledWith('Unhandled error', expect.objectContaining({ message: 'simulated audit-log failure' }));
    spy.mockRestore();

    const second = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
    expect(second.status).toBe(200);

    const { rows: subs } = await q.query(`SELECT count(*)::int AS n FROM subscriptions WHERE parent_id = $1`, [parent.id]);
    expect(subs[0].n).toBe(1); // exactly one entitlement, never two

    const { rows: audits } = await q.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'founding_family_beta.activated' AND actor_id = $1`,
      [buyer],
    );
    expect(audits[0].n).toBeGreaterThanOrEqual(1); // the activation is eventually audited
  });

  it('parallel activation requests survive a mid-flight failure on one of them without ever exceeding one entitlement', async () => {
    const buyer = await makeBuyer(q, 'recover3@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const { token } = await betaInviteRepo.issue(q, { email: 'recover3@example.com', ttlDays: 14 });

    // One of the two concurrent requests will hit a simulated grantBeta
    // failure; mockImplementationOnce affects whichever call reaches the spy
    // first, which is enough to prove the OTHER call (or a follow-up retry)
    // still converges correctly.
    vi.spyOn(subscriptionRepo, 'grantBeta').mockImplementationOnce(() => { throw new Error('simulated failure on one of the parallel attempts'); });

    const results = await Promise.all([
      activatePOST(req(buyer, { parent_id: parent.id, invite_token: token })),
      activatePOST(req(buyer, { parent_id: parent.id, invite_token: token })),
    ]);
    // No restore needed — mockImplementationOnce falls through to the real
    // grantBeta after its single throw, and afterEach restores everything
    // (restoring here would also drop the console.error spy mid-test).

    // At least one of the two must have failed-and-been-retried or succeeded
    // outright; if neither succeeded, retry once more (mirrors the client's
    // own retry-on-error behavior).
    let finalStatuses = results.map((r) => r.status);
    if (!finalStatuses.includes(200)) {
      const retry = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
      finalStatuses = [...finalStatuses, retry.status];
    }
    expect(finalStatuses).toContain(200);

    const { rows } = await q.query(`SELECT count(*)::int AS n FROM subscriptions WHERE parent_id = $1`, [parent.id]);
    expect(rows[0].n).toBe(1); // never more than one, regardless of how many attempts it took
  });

  it('invariant: no invite is ever left redeemed without a corresponding entitlement after retrying', async () => {
    const scenarios: Array<() => void> = [
      () => {
        vi.spyOn(subscriptionRepo, 'grantBeta').mockImplementationOnce(() => { throw new Error('grantBeta boom'); });
      },
      () => {
        vi.spyOn(auditRepo, 'log').mockImplementationOnce(() => { throw new Error('audit boom'); });
      },
    ];

    for (let i = 0; i < scenarios.length; i++) {
      const email = `invariant${i}@example.com`;
      const buyer = await makeBuyer(q, email);
      const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
      const { token } = await betaInviteRepo.issue(q, { email, ttlDays: 14 });

      scenarios[i]();
      const failed = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
      expect(failed.status).toBe(500);
      // mockImplementationOnce is already spent; the retry below runs the real
      // repo. Not calling vi.restoreAllMocks() here keeps the console.error
      // spy alive for the next loop iteration (afterEach does the cleanup).

      const recovered = await activatePOST(req(buyer, { parent_id: parent.id, invite_token: token }));
      expect(recovered.status).toBe(200);

      const invite = await betaInviteRepo.findByToken(q, token);
      const { rows: subs } = await q.query(`SELECT count(*)::int AS n FROM subscriptions WHERE parent_id = $1`, [parent.id]);

      // The core invariant: if the invite is redeemed, an entitlement exists
      // (exactly one) — never "redeemed with zero entitlements" and never
      // "redeemed with more than one entitlement".
      expect(invite?.status).toBe('redeemed');
      expect(subs[0].n).toBe(1);
    }
  });
});
