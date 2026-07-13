import type { Querier } from '../querier';
import type { Plan, Subscription, SubscriptionStatus } from '../types';

/**
 * Billing (Stripe-backed). Single fixed plan for alpha — every subscription
 * this repo creates is 'family'; the other plan_t enum values stay unused
 * until a real plan picker ships.
 */
const ALPHA_PLAN: Plan = 'family';

/** How long a lapsed (past_due) subscription keeps talk access before it's blocked. */
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** The subset of a Stripe Subscription object this repo reads. Kept minimal and
 *  local so this file never needs to import the 'stripe' package's types. */
export interface StripeSubscriptionLike {
  id: string;
  customer: string;
  status: string;
  current_period_end: number; // unix seconds
  metadata: Record<string, string | undefined>;
}

function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    default:
      // canceled, unpaid, incomplete, incomplete_expired — all terminal for our purposes.
      return 'canceled';
  }
}

export const subscriptionRepo = {
  /** The buyer's most recent subscription row (or null if they've never checked out). */
  async getForBuyer(q: Querier, buyerId: string): Promise<Subscription | null> {
    const { rows } = await q.query<Subscription>(
      `SELECT * FROM subscriptions WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [buyerId],
    );
    return rows[0] ?? null;
  },

  /**
   * The single gate other code should call to decide whether a buyer's talk
   * access is currently paid for: true while trialing/active, true for a
   * past_due subscription still within the grace window, false otherwise
   * (canceled, or no subscription at all).
   */
  async isBillingCurrent(q: Querier, buyerId: string, ref: Date = new Date()): Promise<boolean> {
    const sub = await subscriptionRepo.getForBuyer(q, buyerId);
    if (!sub) return false;
    if (sub.status === 'trialing' || sub.status === 'active') return true;
    if (sub.status === 'past_due') {
      const anchor = sub.current_period_end ? new Date(sub.current_period_end) : new Date(sub.created_at);
      const graceUntil = new Date(anchor.getTime() + GRACE_MS);
      return ref < graceUntil;
    }
    return false; // canceled
  },

  /**
   * Sync a subscription row from a Stripe webhook payload. Keyed on
   * stripe_sub_id (no unique DB constraint on that column, so this is a plain
   * select-then-insert-or-update rather than an ON CONFLICT upsert — a small
   * theoretical race on out-of-order webhook delivery, accepted for alpha).
   * buyer_id/parent_id come from subscription_data.metadata, set when the
   * Checkout Session was created (src/app/api/billing/checkout/route.ts).
   */
  async upsertFromStripeSubscription(q: Querier, stripeSub: StripeSubscriptionLike): Promise<Subscription> {
    const status = mapStripeStatus(stripeSub.status);
    const currentPeriodEnd = new Date(stripeSub.current_period_end * 1000).toISOString();

    const { rows: existing } = await q.query<{ id: string }>(
      `SELECT id FROM subscriptions WHERE stripe_sub_id = $1`,
      [stripeSub.id],
    );

    if (existing.length > 0) {
      const { rows } = await q.query<Subscription>(
        `UPDATE subscriptions
            SET status = $2, stripe_customer_id = $3, current_period_end = $4
          WHERE id = $1
          RETURNING *`,
        [existing[0].id, status, stripeSub.customer, currentPeriodEnd],
      );
      return rows[0];
    }

    const buyerId = stripeSub.metadata.buyer_id;
    if (!buyerId) {
      throw new Error('Stripe subscription is missing metadata.buyer_id — cannot attribute it to a buyer.');
    }
    const parentId = stripeSub.metadata.parent_id ?? null;

    const { rows } = await q.query<Subscription>(
      `INSERT INTO subscriptions
         (buyer_id, parent_id, plan, status, stripe_customer_id, stripe_sub_id, current_period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [buyerId, parentId, ALPHA_PLAN, status, stripeSub.customer, stripeSub.id, currentPeriodEnd],
    );
    return rows[0];
  },
};
