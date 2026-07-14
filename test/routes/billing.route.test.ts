import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { makeBuyer, authedReq as buyerReq } from './helpers';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Minimal stand-ins for the Stripe SDK surface the routes touch. Reassigned
// per test via the `stripeMock` object below so each test controls behavior
// without needing a real Stripe key or network call.
const stripeMock = {
  checkoutCreate: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  constructEvent: vi.fn(),
};
vi.mock('@/lib/billing', () => ({
  getStripeClient: () => ({
    checkout: { sessions: { create: stripeMock.checkoutCreate } },
    subscriptions: { retrieve: stripeMock.subscriptionsRetrieve },
    webhooks: { constructEvent: stripeMock.constructEvent },
  }),
}));

// Imported AFTER the mocks so the handlers pick up the mocked db()/billing().
import { POST as checkoutPOST } from '../../src/app/api/billing/checkout/route';
import { POST as webhookPOST } from '../../src/app/api/billing/webhook/route';
import { GET as subscriptionGET } from '../../src/app/api/parents/[id]/subscription/route';

function fakeStripeSubscription(overrides: Partial<{
  id: string; customer: string; status: string; buyerId: string; parentId: string; currentPeriodEndUnix: number;
}> = {}) {
  return {
    id: overrides.id ?? 'sub_123',
    customer: overrides.customer ?? 'cus_123',
    status: overrides.status ?? 'trialing',
    metadata: { buyer_id: overrides.buyerId ?? 'buyer-1', parent_id: overrides.parentId ?? 'parent-1' },
    items: { data: [{ current_period_end: overrides.currentPeriodEndUnix ?? Math.floor(Date.now() / 1000) + 7 * 86400 }] },
  };
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://kindly.example.com';
  vi.clearAllMocks();
});

describe('POST /api/billing/checkout', () => {
  it('401s without a buyer session', async () => {
    const res = await checkoutPOST(
      buyerReq('http://localhost/api/billing/checkout', null, { method: 'POST', body: JSON.stringify({ parent_id: 'x' }) }),
    );
    expect(res.status).toBe(401);
  });

  it('503s when Stripe is not configured (no STRIPE_SECRET_KEY/STRIPE_PRICE_ID)', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_ID;
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });

    const res = await checkoutPOST(
      buyerReq('http://localhost/api/billing/checkout', buyer, { method: 'POST', body: JSON.stringify({ parent_id: parent.id }) }),
    );
    expect(res.status).toBe(503);
    expect(stripeMock.checkoutCreate).not.toHaveBeenCalled();
  });

  it('404s checking out for a parent owned by another buyer (isolation)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_ID = 'price_123';
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await checkoutPOST(
      buyerReq('http://localhost/api/billing/checkout', attacker, { method: 'POST', body: JSON.stringify({ parent_id: parent.id }) }),
    );
    expect(res.status).toBe(404);
  });

  it('creates a subscription-mode Checkout Session with a 7-day trial and card collection forced', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_ID = 'price_123';
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    stripeMock.checkoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/session_abc' });

    const res = await checkoutPOST(
      buyerReq('http://localhost/api/billing/checkout', buyer, { method: 'POST', body: JSON.stringify({ parent_id: parent.id }) }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe('https://checkout.stripe.com/session_abc');

    const call = stripeMock.checkoutCreate.mock.calls[0][0];
    expect(call.mode).toBe('subscription');
    expect(call.payment_method_collection).toBe('always');
    expect(call.subscription_data.trial_period_days).toBe(7);
    expect(call.subscription_data.metadata).toEqual({ buyer_id: buyer, parent_id: parent.id });
    expect(call.line_items).toEqual([{ price: 'price_123', quantity: 1 }]);
    expect(call.success_url).toContain(`parent_id=${parent.id}`);
  });

  it('refuses to start a second trial when the parent already has a current subscription', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_ID = 'price_123';
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    await q.query(
      `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, current_period_end)
       VALUES ($1, $2, 'family', 'trialing', now() + interval '7 days')`,
      [buyer, parent.id],
    );

    const res = await checkoutPOST(
      buyerReq('http://localhost/api/billing/checkout', buyer, { method: 'POST', body: JSON.stringify({ parent_id: parent.id }) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already_subscribed).toBe(true);
    expect(body.url).toBeNull();
    expect(stripeMock.checkoutCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/webhook', () => {
  it('400s a missing signature header', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    const res = await webhookPOST(new NextRequest('http://localhost/api/billing/webhook', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(400);
  });

  it('400s a signature that fails verification', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    stripeMock.constructEvent.mockImplementation(() => {
      throw new Error('signature mismatch');
    });
    const res = await webhookPOST(
      new NextRequest('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'bad' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('checkout.session.completed: retrieves the full subscription and upserts it as trialing', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });

    stripeMock.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { subscription: 'sub_from_checkout', customer: 'cus_1' } },
    });
    stripeMock.subscriptionsRetrieve.mockResolvedValue(
      fakeStripeSubscription({ id: 'sub_from_checkout', customer: 'cus_1', status: 'trialing', buyerId: buyer, parentId: parent.id }),
    );

    const res = await webhookPOST(
      new NextRequest('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'valid' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(200);

    const { rows } = await q.query(`SELECT status, buyer_id, stripe_sub_id FROM subscriptions WHERE stripe_sub_id = 'sub_from_checkout'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('trialing');
    expect(rows[0].buyer_id).toBe(buyer);
  });

  it('customer.subscription.updated: syncs status changes (e.g. trial converting to active)', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    await q.query(
      `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, stripe_sub_id, current_period_end)
       VALUES ($1, $2, 'family', 'trialing', 'sub_update_me', now() + interval '7 days')`,
      [buyer, parent.id],
    );

    stripeMock.constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: fakeStripeSubscription({ id: 'sub_update_me', status: 'active', buyerId: buyer, parentId: parent.id }) },
    });

    const res = await webhookPOST(
      new NextRequest('http://localhost/api/billing/webhook', { method: 'POST', headers: { 'stripe-signature': 'valid' }, body: '{}' }),
    );
    expect(res.status).toBe(200);

    const { rows } = await q.query(`SELECT status FROM subscriptions WHERE stripe_sub_id = 'sub_update_me'`);
    expect(rows[0].status).toBe('active');
  });

  it('customer.subscription.deleted: marks the subscription canceled', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    await q.query(
      `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, stripe_sub_id, current_period_end)
       VALUES ($1, $2, 'family', 'active', 'sub_cancel_me', now() + interval '7 days')`,
      [buyer, parent.id],
    );

    stripeMock.constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: fakeStripeSubscription({ id: 'sub_cancel_me', status: 'canceled', buyerId: buyer, parentId: parent.id }) },
    });

    const res = await webhookPOST(
      new NextRequest('http://localhost/api/billing/webhook', { method: 'POST', headers: { 'stripe-signature': 'valid' }, body: '{}' }),
    );
    expect(res.status).toBe(200);

    const { rows } = await q.query(`SELECT status FROM subscriptions WHERE stripe_sub_id = 'sub_cancel_me'`);
    expect(rows[0].status).toBe('canceled');
  });

  it('an event for an unattributable subscription (no metadata.buyer_id, no existing row) is acknowledged, not a 500', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    // Simulates a subscription this app never created via checkout (e.g.
    // Stripe-dashboard-created, or an out-of-order webhook) — must not crash
    // the handler, since Stripe would otherwise retry the same event forever.
    stripeMock.constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_unknown', customer: 'cus_unknown', status: 'active', metadata: {}, items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) }] } } },
    });

    const res = await webhookPOST(
      new NextRequest('http://localhost/api/billing/webhook', { method: 'POST', headers: { 'stripe-signature': 'valid' }, body: '{}' }),
    );
    expect(res.status).toBe(200);

    const { rows } = await q.query(`SELECT count(*)::int AS n FROM subscriptions WHERE stripe_sub_id = 'sub_unknown'`);
    expect(rows[0].n).toBe(0);
  });
});

describe('GET /api/parents/:id/subscription', () => {
  it('401s without a buyer session', async () => {
    const res = await subscriptionGET(buyerReq('http://localhost/api/parents/x/subscription', null), { params: { id: 'x' } });
    expect(res.status).toBe(401);
  });

  it('404s a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer(q, 'owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer(q, 'attacker@example.com');

    const res = await subscriptionGET(
      buyerReq(`http://localhost/api/parents/${parent.id}/subscription`, attacker),
      { params: { id: parent.id } },
    );
    expect(res.status).toBe(404);
  });

  it('returns null before any subscription exists', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });

    const res = await subscriptionGET(
      buyerReq(`http://localhost/api/parents/${parent.id}/subscription`, buyer),
      { params: { id: parent.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription).toBeNull();
    expect(body.is_current).toBe(false);
  });

  it('returns the parent\'s subscription and is_current=true once one exists', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    await q.query(
      `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, current_period_end)
       VALUES ($1, $2, 'family', 'trialing', now() + interval '7 days')`,
      [buyer, parent.id],
    );

    const res = await subscriptionGET(
      buyerReq(`http://localhost/api/parents/${parent.id}/subscription`, buyer),
      { params: { id: parent.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.status).toBe('trialing');
    expect(body.is_current).toBe(true);
  });

  it('is_current=false for a canceled subscription (the legacy/lapsed recovery case)', async () => {
    const buyer = await makeBuyer(q, 'sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Robert', relationship: 'father' });
    await q.query(
      `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, current_period_end)
       VALUES ($1, $2, 'family', 'canceled', now() - interval '30 days')`,
      [buyer, parent.id],
    );

    const res = await subscriptionGET(
      buyerReq(`http://localhost/api/parents/${parent.id}/subscription`, buyer),
      { params: { id: parent.id } },
    );
    expect((await res.json()).is_current).toBe(false);
  });
});
