import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { referralRepo } from '../../src/lib/repos/referral';
import { referralRewardRepo } from '../../src/lib/repos/referralReward';
import { subscriptionRepo } from '../../src/lib/repos/subscription';
import { makeBuyer, authedReq } from './helpers';

/**
 * Chat 11 acceptance: redeem → first paid invoice → both credits (Stripe
 * mocked); a double webhook gives one credit; self / repeat redeems rejected.
 */

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

const stripeMock = {
  constructEvent: vi.fn(),
  createBalanceTransaction: vi.fn(),
  pricesRetrieve: vi.fn(),
};
vi.mock('@/lib/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing')>();
  return {
    ...actual,
    getStripeClient: () => ({
      webhooks: { constructEvent: stripeMock.constructEvent },
      customers: { createBalanceTransaction: stripeMock.createBalanceTransaction },
      prices: { retrieve: stripeMock.pricesRetrieve },
    }),
  };
});

import { POST as webhookPOST } from '../../src/app/api/billing/webhook/route';
import { GET as referralsGET, POST as referralsPOST } from '../../src/app/api/referrals/route';
import { POST as redeemPOST } from '../../src/app/api/referrals/redeem/route';
import { resetReferralPriceCache } from '../../src/lib/billing/referralCredit';

let txnSeq = 0;

beforeEach(() => {
  q = makeTestDb();
  vi.clearAllMocks();
  resetReferralPriceCache();
  txnSeq = 0;
  process.env.SESSION_SECRET = 'test-secret-value';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  process.env.STRIPE_PRICE_FAMILY_MONTHLY = 'price_month';
  process.env.STRIPE_PRICE_FAMILY_ANNUAL = 'price_year';
  stripeMock.pricesRetrieve.mockImplementation(async (id: string) =>
    id === 'price_year' ? { unit_amount: 27840, currency: 'usd' } : { unit_amount: 2900, currency: 'usd' },
  );
  stripeMock.createBalanceTransaction.mockImplementation(async () => ({ id: `cbtxn_${++txnSeq}` }));
});

async function stripeSub(buyerId: string, customer: string, interval: 'month' | 'year' = 'month') {
  await subscriptionRepo.upsertFromStripeSubscription(q, {
    id: `sub_${customer}`,
    customer,
    status: 'active',
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    metadata: { buyer_id: buyerId },
    billingInterval: interval,
  });
}

function redeemReq(buyerId: string, code: string, ip = '9.9.9.9'): NextRequest {
  return authedReq('http://localhost/api/referrals/redeem', buyerId, {
    method: 'POST',
    body: JSON.stringify({ code }),
    headers: { 'x-forwarded-for': ip },
  });
}

async function sendInvoicePaid(
  eventId: string,
  invoice: { customer: string; amount_paid: number; buyerId?: string },
): Promise<Response> {
  stripeMock.constructEvent.mockReturnValueOnce({
    id: eventId,
    type: 'invoice.paid',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        customer: invoice.customer,
        amount_paid: invoice.amount_paid,
        parent: invoice.buyerId ? { subscription_details: { metadata: { buyer_id: invoice.buyerId } } } : null,
      },
    },
  });
  return webhookPOST(
    new NextRequest('http://localhost/api/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid' },
      body: '{}',
    }),
  );
}

/** A paying referrer, a new family that redeemed their code, and the new family's trial subscription. */
async function setup() {
  const referrer = await makeBuyer(q, 'ref@example.com');
  await stripeSub(referrer, 'cus_ref');
  const { referral } = await referralRepo.getOrCreateActive(q, referrer);
  const newFamily = await makeBuyer(q, 'new@example.com');
  const res = await redeemPOST(redeemReq(newFamily, referral.code));
  expect(res.status).toBe(200);
  await stripeSub(newFamily, 'cus_new');
  return { referrer, newFamily, referral };
}

async function creditAudits() {
  const { rows } = await q.query<{ action: string; meta: Record<string, unknown> }>(
    `SELECT action, meta FROM audit_log WHERE action LIKE 'referral_credit%' ORDER BY id`,
  );
  return rows.map((r) => ({ action: r.action, meta: typeof r.meta === 'string' ? JSON.parse(r.meta) : r.meta }));
}

describe('referral credit: redeem → first paid invoice → both credits', () => {
  it('the $0 trial invoice does nothing; the first paid invoice credits both customers one month', async () => {
    const { referral } = await setup();

    expect((await sendInvoicePaid('evt_trial', { customer: 'cus_new', amount_paid: 0 })).status).toBe(200);
    expect(stripeMock.createBalanceTransaction).not.toHaveBeenCalled();
    expect(await referralRewardRepo.getByReferralId(q, referral.id)).toBeNull();

    const res = await sendInvoicePaid('evt_paid_1', { customer: 'cus_new', amount_paid: 2900 });
    expect(res.status).toBe(200);
    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledTimes(2);
    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_new',
      expect.objectContaining({ amount: -2900, currency: 'usd' }),
      { idempotencyKey: `referral-credit:${referral.id}:referred` },
    );
    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_ref',
      expect.objectContaining({ amount: -2900, currency: 'usd' }),
      { idempotencyKey: `referral-credit:${referral.id}:referrer` },
    );

    const reward = await referralRewardRepo.getByReferralId(q, referral.id);
    expect(reward?.referrer_status).toBe('applied');
    expect(reward?.referred_status).toBe('applied');
    expect(reward?.referrer_amount_cents).toBe(2900);

    const audits = await creditAudits();
    expect(audits.map((a) => a.action)).toEqual(['referral_credit_applied', 'referral_credit_applied']);
    expect(audits.map((a) => a.meta.side).sort()).toEqual(['referred', 'referrer']);
    // No emails or other personal data in the audit meta.
    expect(JSON.stringify(audits)).not.toMatch(/@example\.com/);
  });

  it('finds the buyer from our subscription rows when the invoice carries no metadata', async () => {
    await setup();
    const res = await sendInvoicePaid('evt_paid_nometa', { customer: 'cus_new', amount_paid: 2900 });
    expect(res.status).toBe(200);
    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledTimes(2);
  });

  it('a double webhook (same event redelivered) gives one credit', async () => {
    await setup();
    await sendInvoicePaid('evt_paid_1', { customer: 'cus_new', amount_paid: 2900 });
    const dup = await sendInvoicePaid('evt_paid_1', { customer: 'cus_new', amount_paid: 2900 });
    expect(await dup.json()).toEqual({ received: true, duplicate: true });
    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledTimes(2);
  });

  it('later paid invoices (new event ids) never credit again', async () => {
    await setup();
    await sendInvoicePaid('evt_paid_1', { customer: 'cus_new', amount_paid: 2900 });
    await sendInvoicePaid('evt_paid_2', { customer: 'cus_new', amount_paid: 2900 });
    await sendInvoicePaid('evt_paid_ref', { customer: 'cus_ref', amount_paid: 2900 });
    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledTimes(2);
  });

  it('a Stripe failure answers 500 so Stripe redelivers; the retry only re-tries the failed side', async () => {
    const { referral } = await setup();
    stripeMock.createBalanceTransaction.mockImplementation(async (customer: string) => {
      if (customer === 'cus_ref') throw new Error('stripe down');
      return { id: `cbtxn_${++txnSeq}` };
    });
    const first = await sendInvoicePaid('evt_paid_1', { customer: 'cus_new', amount_paid: 2900 });
    expect(first.status).toBe(500);
    let reward = await referralRewardRepo.getByReferralId(q, referral.id);
    expect(reward?.referred_status).toBe('applied');
    expect(reward?.referrer_status).toBe('failed');

    stripeMock.createBalanceTransaction.mockClear();
    stripeMock.createBalanceTransaction.mockImplementation(async () => ({ id: 'cbtxn_retry' }));
    const retry = await sendInvoicePaid('evt_paid_1', { customer: 'cus_new', amount_paid: 2900 });
    expect(retry.status).toBe(200);
    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledTimes(1);
    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledWith('cus_ref', expect.anything(), {
      idempotencyKey: `referral-credit:${referral.id}:referrer`,
    });
    reward = await referralRewardRepo.getByReferralId(q, referral.id);
    expect(reward?.referrer_status).toBe('applied');
    expect((await creditAudits()).map((a) => a.action)).toEqual([
      'referral_credit_applied',
      'referral_credit_failed',
      'referral_credit_applied',
    ]);
  });

  it('a referrer with no Stripe customer yet is credited on their own first paid invoice', async () => {
    const referrer = await makeBuyer(q, 'beta@example.com'); // e.g. founding beta, never paid
    const { referral } = await referralRepo.getOrCreateActive(q, referrer);
    const newFamily = await makeBuyer(q, 'new@example.com');
    expect((await redeemPOST(redeemReq(newFamily, referral.code))).status).toBe(200);
    await stripeSub(newFamily, 'cus_new');

    expect((await sendInvoicePaid('evt_new_paid', { customer: 'cus_new', amount_paid: 2900 })).status).toBe(200);
    let reward = await referralRewardRepo.getByReferralId(q, referral.id);
    expect(reward?.referred_status).toBe('applied');
    expect(reward?.referrer_status).toBe('failed');
    expect(reward?.referrer_failure_reason).toBe('no_stripe_customer');

    // The new family's next invoice does not re-audit the waiting referrer side.
    expect((await sendInvoicePaid('evt_new_paid_2', { customer: 'cus_new', amount_paid: 2900 })).status).toBe(200);
    expect((await creditAudits()).filter((a) => a.action === 'referral_credit_failed')).toHaveLength(1);

    await stripeSub(referrer, 'cus_ref_later');
    expect((await sendInvoicePaid('evt_ref_paid', { customer: 'cus_ref_later', amount_paid: 2900 })).status).toBe(200);
    reward = await referralRewardRepo.getByReferralId(q, referral.id);
    expect(reward?.referrer_status).toBe('applied');
    expect(stripeMock.createBalanceTransaction).toHaveBeenLastCalledWith('cus_ref_later', expect.anything(), expect.anything());
  });

  it('a yearly subscriber is credited 1/12 of the annual price', async () => {
    const referrer = await makeBuyer(q, 'ref@example.com');
    await stripeSub(referrer, 'cus_ref', 'year');
    const { referral } = await referralRepo.getOrCreateActive(q, referrer);
    const newFamily = await makeBuyer(q, 'new@example.com');
    await redeemPOST(redeemReq(newFamily, referral.code));
    await stripeSub(newFamily, 'cus_new', 'month');
    await sendInvoicePaid('evt_paid', { customer: 'cus_new', amount_paid: 2900 });
    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledWith('cus_ref', expect.objectContaining({ amount: -2320 }), expect.anything());
    expect(stripeMock.createBalanceTransaction).toHaveBeenCalledWith('cus_new', expect.objectContaining({ amount: -2900 }), expect.anything());
  });

  it('an invoice for a customer we do not know is acknowledged without credits', async () => {
    const res = await sendInvoicePaid('evt_unknown', { customer: 'cus_stranger', amount_paid: 2900 });
    expect(res.status).toBe(200);
    expect(stripeMock.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it('the referrer sees pending, then credited', async () => {
    const { referrer } = await setup();
    const before = await (await referralsGET(authedReq('http://localhost/api/referrals', referrer))).json();
    expect(before.redemptions).toEqual([{ redeemed_at: expect.any(String), status: 'pending' }]);
    await sendInvoicePaid('evt_paid_1', { customer: 'cus_new', amount_paid: 2900 });
    const after = await (await referralsGET(authedReq('http://localhost/api/referrals', referrer))).json();
    expect(after.redemptions).toEqual([{ redeemed_at: expect.any(String), status: 'credited' }]);
    // The used code is no longer the active one; nothing identifies the new family.
    expect(after.code).toBeNull();
    expect(JSON.stringify(after)).not.toMatch(/new@example\.com/);
  });
});

describe('referral abuse checks', () => {
  it('rejects redeeming your own code', async () => {
    const me = await makeBuyer(q, 'me@example.com');
    const { referral } = await referralRepo.getOrCreateActive(q, me);
    const res = await redeemPOST(redeemReq(me, referral.code));
    expect(res.status).toBe(400);
  });

  it('rejects a second redemption by the same user (a different code)', async () => {
    const a = await makeBuyer(q, 'a@example.com');
    const b = await makeBuyer(q, 'b@example.com');
    const codeA = (await referralRepo.getOrCreateActive(q, a)).referral.code;
    const codeB = (await referralRepo.getOrCreateActive(q, b)).referral.code;
    const me = await makeBuyer(q, 'me@example.com');
    expect((await redeemPOST(redeemReq(me, codeA, '1.1.1.1'))).status).toBe(200);
    const again = await redeemPOST(redeemReq(me, codeB, '2.2.2.2'));
    expect(again.status).toBe(409);
    expect((await again.json()).error.message).toMatch(/already used a referral code/i);
  });

  it('rejects a used code', async () => {
    const a = await makeBuyer(q, 'a@example.com');
    const code = (await referralRepo.getOrCreateActive(q, a)).referral.code;
    await redeemPOST(redeemReq(await makeBuyer(q, 'x@example.com'), code, '1.1.1.1'));
    const res = await redeemPOST(redeemReq(await makeBuyer(q, 'y@example.com'), code, '2.2.2.2'));
    expect(res.status).toBe(404);
  });

  it('rejects a redeemer who has had any subscription before (new customers only)', async () => {
    const a = await makeBuyer(q, 'a@example.com');
    const code = (await referralRepo.getOrCreateActive(q, a)).referral.code;
    const existing = await makeBuyer(q, 'old@example.com');
    await stripeSub(existing, 'cus_old');
    await q.query(`UPDATE subscriptions SET status = 'canceled' WHERE buyer_id = $1`, [existing]);
    const res = await redeemPOST(redeemReq(existing, code));
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/new families only/i);
  });

  it('keeps the household guard (one redemption per household)', async () => {
    const a = await makeBuyer(q, 'a@example.com');
    const b = await makeBuyer(q, 'b@example.com');
    const codeA = (await referralRepo.getOrCreateActive(q, a)).referral.code;
    const codeB = (await referralRepo.getOrCreateActive(q, b)).referral.code;
    expect((await redeemPOST(redeemReq(await makeBuyer(q, 'x@example.com'), codeA, '7.7.7.7'))).status).toBe(200);
    expect((await redeemPOST(redeemReq(await makeBuyer(q, 'y@example.com'), codeB, '7.7.7.7'))).status).toBe(409);
  });

  it('one active code per user: POST returns the existing code until it is used', async () => {
    const a = await makeBuyer(q, 'a@example.com');
    const post = () => referralsPOST(authedReq('http://localhost/api/referrals', a, { method: 'POST' }));
    const first = await post();
    expect(first.status).toBe(201);
    const { code } = await first.json();
    const second = await post();
    expect(second.status).toBe(200);
    expect((await second.json()).code).toBe(code);

    await redeemPOST(redeemReq(await makeBuyer(q, 'x@example.com'), code));
    const third = await post();
    expect(third.status).toBe(201);
    expect((await third.json()).code).not.toBe(code);
  });

  it('GET reports whether the buyer has used a code (for the onboarding field)', async () => {
    const a = await makeBuyer(q, 'a@example.com');
    const code = (await referralRepo.getOrCreateActive(q, a)).referral.code;
    const me = await makeBuyer(q, 'me@example.com');
    const get = async () => (await referralsGET(authedReq('http://localhost/api/referrals', me))).json();
    expect((await get()).used_code).toBe(false);
    await redeemPOST(redeemReq(me, code));
    expect((await get()).used_code).toBe(true);
  });

  it('the database allows one redemption per user even if the app check is bypassed', async () => {
    const a = await makeBuyer(q, 'a@example.com');
    const me = await makeBuyer(q, 'me@example.com');
    const r1 = await referralRepo.generate(q, a);
    const r2 = await referralRepo.generate(q, a);
    await q.query(`UPDATE referrals SET redeemed_by = $1, redeemed_at = now() WHERE id = $2`, [me, r1.id]);
    await expect(
      q.query(`UPDATE referrals SET redeemed_by = $1, redeemed_at = now() WHERE id = $2`, [me, r2.id]),
    ).rejects.toThrow();
  });
});
