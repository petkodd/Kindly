import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, readJsonBody, errorToResponse } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { clearSession } from '@/lib/session';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });

/** Read the signed-in buyer's own account. */
export async function GET(req: NextRequest) {
  const userId = await resolveBuyer(req);
  if (!userId) return unauthorized();
  try {
    const account = await userRepo.getAccount(db(), userId);
    return NextResponse.json({ account });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** Update the buyer's own profile: display name, and weekly-summary auto-send (decision D5). */
export async function PATCH(req: NextRequest) {
  const userId = await resolveBuyer(req);
  if (!userId) return unauthorized();
  try {
    const body = await readJsonBody(req);
    const account = await userRepo.updateProfile(db(), userId, {
      fullName: body.full_name as string | undefined,
      autoSendSummaries: body.auto_send_summaries,
    });
    return NextResponse.json({ account });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * Delete the buyer's own account and end the session: cancels every
 * subscription in Stripe first (503 and nothing deleted if Stripe can't be
 * reached), revokes every parent talk link, then soft-deletes (hard purge
 * after 30 days).
 */
export async function DELETE(req: NextRequest) {
  const userId = await resolveBuyer(req);
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
