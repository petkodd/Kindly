import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { getStripeClient, getStripeSecretKeyRaw } from '@/lib/billing';
import { subscriptionRepo } from '@/lib/repos/subscription';
import { BillingUnavailableError } from '@/lib/types';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });

/**
 * "Manage billing" on the account page: open a Stripe Billing Portal session
 * for the signed-in buyer's Stripe customer (update card, see invoices,
 * cancel). The customer id comes only from our own subscriptions table for
 * THIS buyer — never from the request. Responses:
 * - 200 `{ url }` — redirect the browser there;
 * - 404 `no_billing_account` — no Stripe customer yet (beta-only, or never
 *   checked out);
 * - 503 `billing_not_configured` — no Stripe key in this environment.
 * Test mode only in alpha; mocked in tests.
 */
export async function POST(req: NextRequest) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return unauthorized();
  if (!getStripeSecretKeyRaw()) {
    return NextResponse.json(
      { error: { code: 'billing_not_configured', message: 'Billing is not configured yet.' } },
      { status: 503 },
    );
  }
  try {
    const pool = db();
    const customer = await subscriptionRepo.latestStripeCustomerForBuyer(pool, buyerId);
    if (!customer) {
      return NextResponse.json(
        {
          error: {
            code: 'no_billing_account',
            message: 'There’s no card on file yet, so there’s nothing to manage. Start a plan from the Parent profile page.',
          },
        },
        { status: 404 },
      );
    }
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://dearly.example.com';
    let url: string;
    try {
      const session = await getStripeClient().billingPortal.sessions.create({
        customer,
        return_url: `${siteUrl}/app/account`,
      });
      url = session.url;
    } catch (err) {
      // Stripe down or misconfigured: never leak its message, just say try later.
      console.error('billing portal session failed', (err as Error).name);
      throw new BillingUnavailableError('We couldn’t reach our billing provider. Please try again in a few minutes.');
    }
    return NextResponse.json({ url });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
