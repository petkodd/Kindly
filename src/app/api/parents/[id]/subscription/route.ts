import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { subscriptionRepo } from '@/lib/repos/subscription';

type Ctx = { params: { id: string } };

/**
 * The buyer's subscription tied to this parent's account (billing is
 * buyer-level, not per-parent). Used by the onboarding wizard to confirm
 * trial status after returning from Stripe Checkout.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    const subscription = await subscriptionRepo.getForBuyer(pool, buyerId);
    return NextResponse.json({ subscription });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
