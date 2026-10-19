import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';

// Next 15: dynamic route params arrive as a Promise.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const parent = await parentRepo.getOwned(db(), params.id, buyerId);
    return NextResponse.json({ parent });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const patch = await req.json();
    const parent = await parentRepo.update(db(), params.id, buyerId, patch);
    return NextResponse.json({ parent });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    await parentRepo.softDelete(db(), params.id, buyerId);
    return new NextResponse(null, { status: 202 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
