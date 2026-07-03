import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { consentRepo } from '@/lib/repos/consent';

// POST /api/parents/[id]/consent — record buyer_attestation or summary_recipient.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation check
    const body = await req.json();
    const input = { parentId: params.id, kind: body.kind, grantedBy: buyerId, detail: body.detail ?? null };
    // buyer_attestation is a singleton per parent — idempotent so an onboarding
    // retry can't insert duplicates. summary_recipient stays one row per recipient.
    const consent =
      body.kind === 'buyer_attestation'
        ? await consentRepo.ensure(pool, input)
        : await consentRepo.record(pool, input);
    return NextResponse.json({ consent }, { status: 201 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
