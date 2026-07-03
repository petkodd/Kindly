import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBuyerId, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { accessTokenRepo } from '@/lib/repos/accessToken';

type Ctx = { params: { id: string } };

/** Issue a passwordless talk link for the parent. Returns the raw token ONCE. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const buyerId = getBuyerId(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    const { token, id } = await accessTokenRepo.issue(pool, params.id);
    return NextResponse.json({ token, id }, { status: 201 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
