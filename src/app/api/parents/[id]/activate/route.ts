import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBuyerId, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';

// POST /api/parents/[id]/activate — gated on buyer_attestation consent (409 if missing).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const buyerId = getBuyerId(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const parent = await parentRepo.activate(db(), params.id, buyerId);
    return NextResponse.json({ parent });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
