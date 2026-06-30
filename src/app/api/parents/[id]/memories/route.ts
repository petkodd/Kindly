import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBuyerId, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { memoryRepo } from '@/lib/repos/memory';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const buyerId = getBuyerId(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    const url = new URL(req.url);
    const layer = url.searchParams.get('layer') ?? undefined;
    const status = url.searchParams.get('status') ?? undefined;
    const memories = await memoryRepo.list(pool, params.id, { layer: layer as never, status });
    return NextResponse.json({ memories });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const buyerId = getBuyerId(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    const b = await req.json();
    const memory = await memoryRepo.add(pool, {
      parentId: params.id,
      layer: b.layer,
      key: b.key,
      value: b.value,
      source: b.source ?? 'onboarding',
      sensitivity: b.sensitivity,
      createdBy: buyerId,
    });
    return NextResponse.json({ memory }, { status: 201 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
