import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, readJsonBody, errorToResponse } from '@/lib/auth';
import { getStripeClient, getPriceIdForInterval, type BillingInterval } from '@/lib/billing';
import { parentRepo } from '@/lib/repos/parent';
import { subscriptionRepo } from '@/lib/repos/subscription';
import { userRepo } from '@/lib/repos/user';
import { ValidationError } from '@/lib/types';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });

const notConfigured = () =>
  NextResponse.json(
    { error: { code: 'billing_not_configured', message: 'Billing is not configured yet.' } },
    { status: 503 },
  );

const TRIAL_DAYS = 7;

/**
 * Start a 7-day free trial: creates a Stripe Checkout Session in subscription
 * mode with payment_method_collection: 'always', so the card is captured
 * upfront even though $0 is due today. Card entry itself happens entirely on
 * Stripe's hosted page — we never see or handle raw card data.
 */
export async function POST(req: NextRequest) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return unauthorized();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://kindly.example.com';
  if (!process.env.STRIPE_SECRET_KEY) return notConfigured();

  try {
    const pool = db();
    const body = await readJsonBody(req);
    const parentId = body.parent_id as string;
    if (!parentId) throw new ValidationError('parent_id is required');

    // Never trust a client-supplied Stripe Price id directly — only this
    // closed enum, resolved server-side to the env-configured id (same
    // principle as household_hash in the referral flow: a client-controlled
    // value that determines money must never be taken at face value).
    const intervalInput = (body.interval as string | undefined) ?? 'month';
    if (intervalInput !== 'month' && intervalInput !== 'year') {
      throw new ValidationError("interval must be 'month' or 'year'");
    }
    const interval = intervalInput as BillingInterval;

    let priceId: string;
    try {
      priceId = getPriceIdForInterval(interval);
    } catch {
      // That specific interval isn't configured yet (e.g. the annual Price
      // hasn't been created) — degrade the same way as no billing at all,
      // rather than 500ing, so annual can ship ahead of the Price existing.
      return notConfigured();
    }

    await parentRepo.getOwned(pool, parentId, buyerId); // isolation

    // Refuse to start a second trial/subscription for a parent that already
    // has one current — without this, a transient failure in the post-checkout
    // /activate call (see BillingStep) would send the user back to "Start
    // trial" and risk creating (and eventually being charged for) a second
    // Stripe subscription for the same parent.
    if (await subscriptionRepo.isBillingCurrent(pool, parentId)) {
      return NextResponse.json({ url: null, already_subscribed: true });
    }

    const buyer = await userRepo.getAccount(pool, buyerId);

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: buyer.email,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { buyer_id: buyerId, parent_id: parentId },
      },
      payment_method_collection: 'always',
      success_url: `${siteUrl}/app/onboarding?billing=success&parent_id=${parentId}`,
      cancel_url: `${siteUrl}/app/onboarding?billing=cancel&parent_id=${parentId}`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
