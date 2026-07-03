import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { summaryRepo } from '@/lib/repos/summary';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    const parent = await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    const summary = await summaryRepo.preview(pool, params.id, parent.first_name);
    return NextResponse.json({ summary });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
