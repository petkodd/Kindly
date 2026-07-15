import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { consentRepo } from '@/lib/repos/consent';
import { ValidationError } from '@/lib/types';

// POST /api/parents/[id]/consent — record buyer_attestation. summary_recipient
// consent is NEVER accepted here: it must only ever be created in a 'pending'
// state via POST /api/parents/[id]/invite-sibling and flipped to 'accepted' by
// the recipient clicking their emailed token (POST /api/invites/accept). This
// route accepting summary_recipient directly would let a buyer self-attest a
// third party's consent and have it counted as accepted with no recipient
// action at all.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation check
    const body = await req.json();
    if (body.kind !== 'buyer_attestation') {
      throw new ValidationError('Only buyer_attestation can be recorded here.');
    }
    const input = { parentId: params.id, kind: body.kind, grantedBy: buyerId, detail: body.detail ?? null };
    // Singleton per parent — idempotent so an onboarding retry can't insert duplicates.
    const consent = await consentRepo.ensure(pool, input);
    return NextResponse.json({ consent }, { status: 201 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
