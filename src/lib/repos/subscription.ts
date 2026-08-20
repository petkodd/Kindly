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
    if (sub.status === 'beta') {
      // No grace period — a beta grant simply has a hard end date, and past
      // it there is no automatic conversion/charge (see grantBeta).
      return !!sub.current_period_end && ref < new Date(sub.current_period_end);
    }
    if (sub.status === 'past_due') {
      const anchor = sub.current_period_end ? new Date(sub.current_period_end) : new Date(sub.created_at);
      const graceUntil = new Date(anchor.getTime() + GRACE_MS);
      return ref < graceUntil;
    }
    return false; // canceled
  },

  /**
   * Grant a Founding Family Beta entitlement for a parent, from a
   * just-redeemed beta_invites row. Never touches Stripe.
   *
   * Idempotency check FIRST: if this exact invite already granted a row
   * (an earlier call succeeded but the caller never saw the response — a
   * dropped connection, a retry after a downstream failure such as the
   * audit-log write, or a genuine concurrent duplicate request), return that
   * same row as `already_granted` rather than re-deriving the outcome from
   * `isBillingCurrent` (which, since that earlier grant IS itself a current
   * beta subscription, would otherwise misreport this as
   * `existing_paid_access`). This ordering is what makes a retry after a
   * partial failure recover cleanly — see the activation route and
   * betaActivate.route.test.ts's recovery tests.
   *
   * Preserves existing paid access: only once we know THIS invite hasn't
   * already granted anything do we check whether the parent has some OTHER
   * currently billing-current subscription (trial/active/past_due-in-grace)
   * — if so, this is a no-op that reports `existing_paid_access` rather than
   * layering a second, competing row on top. A paid/trialing entitlement
   * must never be downgraded to beta.
   *
   * Race-safe without needing this call itself to run inside a transaction:
   * `beta_invite_id` is UNIQUE (migration 0013), so `ON CONFLICT ... DO
   * NOTHING` guarantees at most one subscription row can ever be created per
   * invite, even under true concurrent INSERTs. The loser simply reads back
   * the winner's row. (The activation route additionally runs this inside
   * withTransaction alongside the invite redemption + audit log, for true
   * all-or-nothing atomicity on real Postgres.)
   */
  async grantBeta(
    q: Querier,
    input: { buyerId: string; parentId: string; betaInviteId: string; days: number },
  ): Promise<{ outcome: 'granted' | 'already_granted' | 'existing_paid_access'; subscription: Subscription | null }> {
    const { rows: existingForInvite } = await q.query<Subscription>(
      `SELECT * FROM subscriptions WHERE beta_invite_id = $1`,
      [input.betaInviteId],
    );
    if (existingForInvite[0]) {
      return { outcome: 'already_granted', subscription: existingForInvite[0] };
    }

    if (await subscriptionRepo.isBillingCurrent(q, input.parentId)) {
      return { outcome: 'existing_paid_access', subscription: await subscriptionRepo.getForParent(q, input.parentId) };
    }
    const endsAt = new Date(Date.now() + input.days * 24 * 60 * 60 * 1000).toISOString();
    const { rows } = await q.query<Subscription>(
      `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, current_period_end, beta_invite_id)
       VALUES ($1, $2, $3, 'beta', $4, $5)
       ON CONFLICT (beta_invite_id) DO NOTHING
       RETURNING *`,
      [input.buyerId, input.parentId, ALPHA_PLAN, endsAt, input.betaInviteId],
    );
    if (rows[0]) return { outcome: 'granted', subscription: rows[0] };

    // True concurrent race lost between our SELECT above and this INSERT.
    const { rows: existing } = await q.query<Subscription>(
      `SELECT * FROM subscriptions WHERE beta_invite_id = $1`,
      [input.betaInviteId],
    );
    return { outcome: 'already_granted', subscription: existing[0] ?? null };
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
      // by status/period, never touching attribution. COALESCE on
      // billing_interval: a payload that doesn't resolve an interval (see
      // toSubscriptionLike) must not erase an already-known one — it should
      // leave the last known value in place, not regress it to NULL.
      const { rows } = await q.query<Subscription>(
        `UPDATE subscriptions
            SET status = $2, stripe_customer_id = $3, current_period_end = $4,
                billing_interval = COALESCE($5, billing_interval)
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
             billing_interval = COALESCE(EXCLUDED.billing_interval, subscriptions.billing_interval)
       RETURNING *`,
      [buyerId, parentId, ALPHA_PLAN, status, stripeSub.customer, stripeSub.id, currentPeriodEnd, stripeSub.billingInterval],
    );
    return rows[0];
  },
};
