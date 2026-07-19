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
  /** Read live from the Stripe Price's recurring.interval — null if absent/unrecognized. */
  billingInterval: 'month' | 'year' | null;
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
  /**
   * A parent's most recent subscription row (or null if none exists yet).
   * Billing is scoped per PARENT, not per buyer — a buyer with several
   * parents can have one active and one lapsed subscription at once, and
   * each must gate only its own parent's talk access (see isBillingCurrent).
   */
  async getForParent(q: Querier, parentId: string): Promise<Subscription | null> {
    const { rows } = await q.query<Subscription>(
      `SELECT * FROM subscriptions WHERE parent_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [parentId],
    );
    return rows[0] ?? null;
  },

  /**
   * The single gate other code should call to decide whether a specific
   * parent's talk access is currently paid for: true while trialing/active,
   * true for a past_due subscription still within the grace window, false
   * otherwise (canceled, or no subscription at all).
   */
  async isBillingCurrent(q: Querier, parentId: string, ref: Date = new Date()): Promise<boolean> {
    const sub = await subscriptionRepo.getForParent(q, parentId);
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
   * Sync a subscription row from a Stripe webhook payload, keyed on
   * stripe_sub_id (UNIQUE — migration 0009). buyer_id/parent_id come from
   * subscription_data.metadata, set when the Checkout Session was created
   * (src/app/api/billing/checkout/route.ts), and persist on the Stripe
   * object thereafter, so every event for a subscription we originated
   * carries them.
   *
   * Returns null (does not throw) when the subscription can't be attributed
   * to a buyer AND we have no existing row for it — e.g. a subscription
   * created outside our checkout flow (Stripe dashboard, test mode) or an
   * out-of-order webhook delivered before we've ever seen this subscription.
   * Retrying won't help in that case, so the caller (the webhook route)
   * should acknowledge and move on rather than erroring — an uncaught throw
   * here would have Stripe retry the same unfixable event forever.
   */
  async upsertFromStripeSubscription(q: Querier, stripeSub: StripeSubscriptionLike): Promise<Subscription | null> {
    const status = mapStripeStatus(stripeSub.status);
    const currentPeriodEnd = new Date(stripeSub.current_period_end * 1000).toISOString();
    const buyerId = stripeSub.metadata.buyer_id;

    if (!buyerId) {
      // Can't INSERT (buyer_id is NOT NULL) — at most update an existing row
      // by status/period, never touching attribution.
      const { rows } = await q.query<Subscription>(
        `UPDATE subscriptions
            SET status = $2, stripe_customer_id = $3, current_period_end = $4, billing_interval = $5
          WHERE stripe_sub_id = $1
          RETURNING *`,
        [stripeSub.id, status, stripeSub.customer, currentPeriodEnd, stripeSub.billingInterval],
      );
      return rows[0] ?? null;
    }

    const parentId = stripeSub.metadata.parent_id ?? null;
    const { rows } = await q.query<Subscription>(
      `INSERT INTO subscriptions
         (buyer_id, parent_id, plan, status, stripe_customer_id, stripe_sub_id, current_period_end, billing_interval)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (stripe_sub_id) DO UPDATE
         SET status = EXCLUDED.status,
             stripe_customer_id = EXCLUDED.stripe_customer_id,
             current_period_end = EXCLUDED.current_period_end,
             billing_interval = EXCLUDED.billing_interval
       RETURNING *`,
      [buyerId, parentId, ALPHA_PLAN, status, stripeSub.customer, stripeSub.id, currentPeriodEnd, stripeSub.billingInterval],
    );
    return rows[0];
  },
};
