import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { subscriptionRepo } from '../src/lib/repos/subscription';
import { parentRepo } from '../src/lib/repos/parent';

let q: Querier;

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function makeParent(buyerId: string): Promise<string> {
  const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });
  return parent.id;
}

async function insertSubscription(
  buyerId: string,
  parentId: string,
  opts: { status: 'trialing' | 'active' | 'past_due' | 'canceled'; currentPeriodEnd: Date; stripeSubId?: string },
): Promise<void> {
  await q.query(
    `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, stripe_sub_id, current_period_end)
     VALUES ($1, $2, 'family', $3, $4, $5)`,
    [buyerId, parentId, opts.status, opts.stripeSubId ?? `sub_${Math.random()}`, opts.currentPeriodEnd],
  );
}

beforeEach(() => {
  q = makeTestDb();
});

describe('subscriptionRepo.getForParent', () => {
  it('returns null when the parent has no subscription yet', async () => {
    const buyer = await makeBuyer('sarah@example.com');
    const parent = await makeParent(buyer);
    expect(await subscriptionRepo.getForParent(q, parent)).toBeNull();
  });

  it('returns the most recent row when several exist for the same parent', async () => {
    const buyer = await makeBuyer('sarah@example.com');
    const parent = await makeParent(buyer);
    await insertSubscription(buyer, parent, { status: 'canceled', currentPeriodEnd: new Date('2026-01-01') });
    await insertSubscription(buyer, parent, { status: 'trialing', currentPeriodEnd: new Date('2026-07-01') });
    const sub = await subscriptionRepo.getForParent(q, parent);
    expect(sub?.status).toBe('trialing');
  });
});

describe('subscriptionRepo.isBillingCurrent', () => {
  it('is false with no subscription at all', async () => {
    const buyer = await makeBuyer('a@example.com');
    const parent = await makeParent(buyer);
    expect(await subscriptionRepo.isBillingCurrent(q, parent)).toBe(false);
  });

  it('is true while trialing', async () => {
    const buyer = await makeBuyer('b@example.com');
    const parent = await makeParent(buyer);
    await insertSubscription(buyer, parent, { status: 'trialing', currentPeriodEnd: new Date(Date.now() + 86400000) });
    expect(await subscriptionRepo.isBillingCurrent(q, parent)).toBe(true);
  });

  it('is true while active', async () => {
    const buyer = await makeBuyer('c@example.com');
    const parent = await makeParent(buyer);
    await insertSubscription(buyer, parent, { status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) });
    expect(await subscriptionRepo.isBillingCurrent(q, parent)).toBe(true);
  });

  it('is true for past_due still within the 3-day grace window', async () => {
    const buyer = await makeBuyer('d@example.com');
    const parent = await makeParent(buyer);
    const periodEnd = new Date(Date.now() - 2 * 86400000); // failed 2 days ago
    await insertSubscription(buyer, parent, { status: 'past_due', currentPeriodEnd: periodEnd });
    expect(await subscriptionRepo.isBillingCurrent(q, parent)).toBe(true);
  });

  it('is false for past_due once the grace window has elapsed', async () => {
    const buyer = await makeBuyer('e@example.com');
    const parent = await makeParent(buyer);
    const periodEnd = new Date(Date.now() - 4 * 86400000); // failed 4 days ago
    await insertSubscription(buyer, parent, { status: 'past_due', currentPeriodEnd: periodEnd });
    expect(await subscriptionRepo.isBillingCurrent(q, parent)).toBe(false);
  });

  it('is false once canceled', async () => {
    const buyer = await makeBuyer('f@example.com');
    const parent = await makeParent(buyer);
    await insertSubscription(buyer, parent, { status: 'canceled', currentPeriodEnd: new Date(Date.now() + 86400000) });
    expect(await subscriptionRepo.isBillingCurrent(q, parent)).toBe(false);
  });

  it('REGRESSION: a buyer with two parents keeps the active one billed even after the other lapses', async () => {
    // This is the exact bug the per-parent scoping fixes: billing must never
    // be resolved by "the buyer's most recent subscription" — each parent's
    // access depends only on ITS OWN subscription.
    const buyer = await makeBuyer('multi-parent@example.com');
    const activeParent = await makeParent(buyer);
    await insertSubscription(buyer, activeParent, { status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) });

    // A second, newer parent's subscription lapses.
    const lapsedParent = await makeParent(buyer);
    await insertSubscription(buyer, lapsedParent, { status: 'canceled', currentPeriodEnd: new Date(Date.now() - 30 * 86400000) });

    expect(await subscriptionRepo.isBillingCurrent(q, activeParent)).toBe(true);
    expect(await subscriptionRepo.isBillingCurrent(q, lapsedParent)).toBe(false);
  });
});

describe('subscriptionRepo.upsertFromStripeSubscription', () => {
  const periodEndUnix = Math.floor((Date.now() + 7 * 86400000) / 1000);

  it('inserts a new row from metadata.buyer_id/parent_id on first sync', async () => {
    const buyer = await makeBuyer('g@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const sub = await subscriptionRepo.upsertFromStripeSubscription(q, {
      id: 'sub_abc123',
      customer: 'cus_abc123',
      status: 'trialing',
      current_period_end: periodEndUnix,
      metadata: { buyer_id: buyer, parent_id: parent.id },
    });
    expect(sub?.buyer_id).toBe(buyer);
    expect(sub?.parent_id).toBe(parent.id);
    expect(sub?.plan).toBe('family');
    expect(sub?.status).toBe('trialing');
    expect(sub?.stripe_customer_id).toBe('cus_abc123');
    expect(sub?.stripe_sub_id).toBe('sub_abc123');
  });

  it('updates the existing row in place on a later sync, keyed by stripe_sub_id', async () => {
    const buyer = await makeBuyer('h@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    await subscriptionRepo.upsertFromStripeSubscription(q, {
      id: 'sub_xyz789',
      customer: 'cus_xyz789',
      status: 'trialing',
      current_period_end: periodEndUnix,
      metadata: { buyer_id: buyer, parent_id: parent.id },
    });

    const updated = await subscriptionRepo.upsertFromStripeSubscription(q, {
      id: 'sub_xyz789',
      customer: 'cus_xyz789',
      status: 'active',
      current_period_end: periodEndUnix + 30 * 86400,
      metadata: { buyer_id: buyer, parent_id: parent.id },
    });
    expect(updated?.status).toBe('active');

    const { rows } = await q.query(`SELECT count(*)::int AS n FROM subscriptions WHERE stripe_sub_id = 'sub_xyz789'`);
    expect(rows[0].n).toBe(1); // updated in place, not duplicated
  });

  it('maps unrecognized/terminal Stripe statuses to canceled', async () => {
    const buyer = await makeBuyer('i@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    const sub = await subscriptionRepo.upsertFromStripeSubscription(q, {
      id: 'sub_unpaid',
      customer: 'cus_unpaid',
      status: 'unpaid',
      current_period_end: periodEndUnix,
      metadata: { buyer_id: buyer, parent_id: parent.id },
    });
    expect(sub?.status).toBe('canceled');
  });

  it('skips (does not throw) an event for a subscription we cannot attribute — missing metadata.buyer_id and no existing row', async () => {
    // Realistic case: a subscription created outside our checkout flow (Stripe
    // dashboard, test mode) or an out-of-order webhook delivery. This must
    // never throw — an uncaught error here would crash the webhook handler
    // and Stripe would retry the same unfixable event forever.
    const result = await subscriptionRepo.upsertFromStripeSubscription(q, {
      id: 'sub_no_buyer',
      customer: 'cus_no_buyer',
      status: 'trialing',
      current_period_end: periodEndUnix,
      metadata: {},
    });
    expect(result).toBeNull();
    const { rows } = await q.query(`SELECT count(*)::int AS n FROM subscriptions WHERE stripe_sub_id = 'sub_no_buyer'`);
    expect(rows[0].n).toBe(0);
  });
});
