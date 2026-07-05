import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { consentRepo } from '@/lib/repos/consent';

type Ctx = { params: { id: string } };

/**
 * List a parent's summary recipients (pending + accepted). consentRepo.listRecipients
 * returns a safe { id, email, status } view — the invite_token_hash held in the
 * consent detail never leaves the repo boundary.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    const recipients = await consentRepo.listRecipients(pool, params.id);
    return NextResponse.json({ recipients });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
