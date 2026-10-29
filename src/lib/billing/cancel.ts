import type Stripe from 'stripe';
import type { Querier } from '../querier';
import { BillingUnavailableError } from '../types';
import { getStripeClient } from './index';
import { getStripeSecretKeyRaw } from './config';

/**
 * Cancel billing before an account or a parent profile is deleted, so a
 * deleted profile is never charged again. Called by the delete paths in
 * userRepo / parentRepo.
 *
 * - Every live subscription (trialing, active, past_due) with a Stripe id is
 *   cancelled in Stripe immediately (not at period end: the data is going).
 * - Local rows for those subscriptions, and any beta entitlement, are marked
 *   'canceled'.
 * - Idempotent: a subscription Stripe already cancelled or no longer knows
 *   counts as done, so a retried delete never fails on it.
 * - If Stripe can't be reached (or isn't configured while a Stripe
 *   subscription exists) this throws BillingUnavailableError (503) BEFORE
 *   anything is deleted, so a customer is never left being billed for a
 *   profile that is gone.
 */

interface SubRow {
  id: string;
  stripe_sub_id: string | null;
  status: string;
}

const LIVE = new Set(['trialing', 'active', 'past_due', 'beta']);

async function cancelInStripe(stripeSubId: string): Promise<void> {
  if (!getStripeSecretKeyRaw()) {
    throw new BillingUnavailableError();
  }
  const stripe = getStripeClient();
  try {
    await stripe.subscriptions.cancel(stripeSubId);
  } catch (err) {
    const e = err as { code?: string; statusCode?: number };
    if (e.code === 'resource_missing' || e.statusCode === 404) return; // already gone in Stripe
    // Already cancelled (Stripe refuses to cancel twice): check and accept.
    try {
      const sub: Stripe.Subscription = await stripe.subscriptions.retrieve(stripeSubId);
      if (sub.status === 'canceled' || sub.status === 'incomplete_expired') return;
    } catch {
      // fall through to the unavailable error below
    }
    console.error('stripe cancel failed', stripeSubId, e.code ?? e.statusCode);
    throw new BillingUnavailableError();
  }
}

async function cancelRows(q: Querier, rows: SubRow[]): Promise<{ stripeCanceled: number }> {
  let stripeCanceled = 0;
  for (const row of rows) {
    if (!LIVE.has(row.status)) continue;
    if (row.stripe_sub_id) {
      await cancelInStripe(row.stripe_sub_id);
      stripeCanceled += 1;
    }
  }
  for (const row of rows) {
    if (!LIVE.has(row.status)) continue;
    await q.query(`UPDATE subscriptions SET status = 'canceled' WHERE id = $1`, [row.id]);
  }
  return { stripeCanceled };
}

export const billingCancellation = {
  /** Every subscription a buyer pays for (all their parents, and any not yet tied to one). */
  async cancelForBuyer(q: Querier, buyerId: string): Promise<{ stripeCanceled: number }> {
    const { rows } = await q.query<SubRow>(
      `SELECT id, stripe_sub_id, status FROM subscriptions WHERE buyer_id = $1`,
      [buyerId],
    );
    return cancelRows(q, rows);
  },

  /** The subscriptions for one parent profile. */
  async cancelForParent(q: Querier, parentId: string): Promise<{ stripeCanceled: number }> {
    const { rows } = await q.query<SubRow>(
      `SELECT id, stripe_sub_id, status FROM subscriptions WHERE parent_id = $1`,
      [parentId],
    );
    return cancelRows(q, rows);
  },
};
