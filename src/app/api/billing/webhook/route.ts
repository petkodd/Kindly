import type Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getStripeClient } from '@/lib/billing';
import { subscriptionRepo, type StripeSubscriptionLike } from '@/lib/repos/subscription';

function toSubscriptionLike(sub: Stripe.Subscription): StripeSubscriptionLike {
  // current_period_end lives per line item as of the current Stripe API
  // version, not on the subscription itself. Alpha has exactly one price per
  // subscription, so the first item's period end is the subscription's.
  const currentPeriodEnd = sub.items.data[0]?.current_period_end ?? Math.floor(Date.now() / 1000);
  // Read live from the Price's own recurring.interval rather than inferring
  // from which env var string matches — stays correct even if Price ids are
  // rotated. Anything other than month/year (shouldn't happen for our plans)
  // maps to null, not guessed.
  const interval = sub.items.data[0]?.price?.recurring?.interval;
  const billingInterval = interval === 'month' || interval === 'year' ? interval : null;
  return {
    id: sub.id,
    customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    status: sub.status,
    current_period_end: currentPeriodEnd,
    metadata: sub.metadata,
    billingInterval,
  };
}

/**
 * Stripe webhook receiver. Unauthenticated by design — Stripe calls this
 * directly — so trust is established entirely by verifying the signature
 * against the raw request body. Runs on the default Node.js runtime (no
 * route in this app uses the edge runtime, and the Stripe SDK needs Node).
 */
export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: { code: 'invalid_request', message: 'Missing signature.' } }, { status: 400 });
  }

  // MUST read the raw body — constructEvent verifies the signature against
  // these exact bytes, so this can never go through req.json() first.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: { code: 'invalid_signature', message: 'Invalid signature.' } }, { status: 400 });
  }

  const pool = db();

  // Idempotency: a redelivered event that was already applied is acknowledged and skipped.
  // (Real Stripe events always carry an id and a created time; the guards keep
  // a malformed payload from crashing the handler.)
  if (event.id) {
    const { rows: seen } = await pool.query(`SELECT 1 FROM stripe_events WHERE id = $1`, [event.id]);
    if (seen.length > 0) return NextResponse.json({ received: true, duplicate: true });
  }

  // Stripe's own timestamp for this event; older events never overwrite newer state.
  const eventAt = Number.isFinite(event.created) ? new Date(event.created * 1000) : new Date();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (typeof session.subscription === 'string') {
          const subscription = await getStripeClient().subscriptions.retrieve(session.subscription);
          // Read fresh from Stripe, so it is current state as of now.
          await subscriptionRepo.upsertFromStripeSubscription(pool, toSubscriptionLike(subscription), eventAt);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await subscriptionRepo.upsertFromStripeSubscription(pool, toSubscriptionLike(subscription), eventAt);
        break;
      }
      default:
        break; // other event types are not relevant to billing state
    }
    // Recorded only after it was applied, so a failure above lets Stripe retry it.
    if (event.id) {
      await pool.query(
        `INSERT INTO stripe_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        [event.id, event.type],
      );
    }
  } catch (err) {
    // A genuinely unexpected failure (DB unreachable, etc.) — 500 so Stripe's
    // automatic retry can succeed once the transient condition clears.
    // upsertFromStripeSubscription itself never throws for the "unknown
    // subscription" case (see its own doc comment); it returns null instead.
    console.error('billing webhook processing failed', event.type, err);
    return NextResponse.json({ error: { code: 'server_error', message: 'Webhook processing failed.' } }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
