import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBuyerId, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { summaryRepo } from '@/lib/repos/summary';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const buyerId = getBuyerId(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    const summaries = await summaryRepo.list(pool, params.id);
    return NextResponse.json({ summaries });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
