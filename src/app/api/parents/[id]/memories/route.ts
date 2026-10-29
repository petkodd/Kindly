import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse, readJsonBody } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { memoryRepo } from '@/lib/repos/memory';
import { STORABLE_SENSITIVITIES, type MemoryLayer, type Sensitivity } from '@/lib/types';

// Next 15: dynamic route params arrive as a Promise.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    const url = new URL(req.url);
    const layer = url.searchParams.get('layer') ?? undefined;
    const status = url.searchParams.get('status') ?? undefined;
    // memoryRepo.list never returns restricted rows (decision D6) and rejects
    // unknown filters; proposed rows are included so the buyer can review them.
    const memories = await memoryRepo.list(pool, params.id, { layer, status });
    return NextResponse.json({ memories });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    const b = await readJsonBody(req);
    // The server decides who wrote this: a signed-in buyer is always 'family'
    // (so a client can't pass a memory off as something the parent said), and
    // sensitivity is limited to the storable allow-list. Layer, key and value
    // are validated and capped by memoryRepo.add.
    const sensitivity: Sensitivity = (STORABLE_SENSITIVITIES as unknown[]).includes(b.sensitivity)
      ? (b.sensitivity as Sensitivity)
      : 'normal';
    const memory = await memoryRepo.add(pool, {
      parentId: params.id,
      layer: b.layer as MemoryLayer,
      key: b.key as string,
      value: b.value as string,
      source: 'family',
      sensitivity,
      createdBy: buyerId,
    });
    return NextResponse.json({ memory }, { status: 201 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
