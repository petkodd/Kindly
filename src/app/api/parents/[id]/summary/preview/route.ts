import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { summaryRepo } from '@/lib/repos/summary';

// Next 15: dynamic route params arrive as a Promise.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    const parent = await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    // Read-only (decision D5): shows what a send would deliver — the last full
    // week — without writing anything. Sending (POST …/summary/send) stores it.
    const summary = await summaryRepo.peek(pool, params.id, parent.first_name);
    return NextResponse.json({ summary });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
