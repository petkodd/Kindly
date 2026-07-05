import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { memoryRepo } from '@/lib/repos/memory';

type Ctx = { params: { mid: string } };

// PATCH /api/memories/[mid] — { action: 'confirm' | 'retire' }
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const { action } = await req.json();
    if (action === 'confirm') {
      const memory = await memoryRepo.confirm(db(), params.mid, buyerId);
      return NextResponse.json({ memory });
    }
    if (action === 'retire') {
      await memoryRepo.retire(db(), params.mid, buyerId);
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json({ error: { code: 'invalid_input', message: 'Unknown action.' } }, { status: 400 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    await memoryRepo.hardDelete(db(), params.mid, buyerId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
