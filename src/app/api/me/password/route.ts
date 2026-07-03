import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBuyerId, readJsonBody, errorToResponse } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { ValidationError } from '@/lib/types';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });

/** Change the buyer's password (requires the current password). */
export async function POST(req: NextRequest) {
  const userId = getBuyerId(req);
  if (!userId) return unauthorized();
  try {
    const body = await readJsonBody(req);
    const current = body.current_password as string;
    const next = body.new_password as string;
    if (!current || !next) throw new ValidationError('current_password and new_password are required');
    await userRepo.changePassword(db(), userId, current, next);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
