import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBuyerId, readJsonBody, errorToResponse } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { clearSession } from '@/lib/session';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });

/** Read the signed-in buyer's own account. */
export async function GET(req: NextRequest) {
  const userId = getBuyerId(req);
  if (!userId) return unauthorized();
  try {
    const account = await userRepo.getAccount(db(), userId);
    return NextResponse.json({ account });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** Update the buyer's own profile (display name). */
export async function PATCH(req: NextRequest) {
  const userId = getBuyerId(req);
  if (!userId) return unauthorized();
  try {
    const body = await readJsonBody(req);
    const account = await userRepo.updateProfile(db(), userId, { fullName: body.full_name as string });
    return NextResponse.json({ account });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** Soft-delete the buyer's own account and end the session. */
export async function DELETE(req: NextRequest) {
  const userId = getBuyerId(req);
  if (!userId) return unauthorized();
  try {
    await userRepo.softDelete(db(), userId);
    // 202: queued for purge within the retention window; also log the caller out.
    return clearSession(new NextResponse(null, { status: 202 }));
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
