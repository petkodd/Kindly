import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { subscriptionRepo } from '@/lib/repos/subscription';

type Ctx = { params: { id: string } };

/**
 * This parent's subscription (billing is scoped per parent, not per buyer —
 * a buyer with several parents can have independent billing states for
 * each). Used by the onboarding wizard to confirm trial status after
 * returning from Stripe Checkout, and by the parent-profile page to offer a
 * "start trial" recovery path for an activated parent with no current billing.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    const subscription = await subscriptionRepo.getForParent(pool, params.id);
    // Computed server-side so clients never re-derive the grace-period math.
    const isCurrent = await subscriptionRepo.isBillingCurrent(pool, params.id);
    return NextResponse.json({ subscription, is_current: isCurrent });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
