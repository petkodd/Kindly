import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, rejectCrossOrigin } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { clearSession } from '@/lib/session';

/**
 * Log out for real: move the user's session watermark
 * (users.sessions_valid_from) to now, so this session token — and every other
 * one issued before it, on any device — is rejected from the next request on,
 * even if someone copied the cookie. Then clear the cookie. Always 204.
 *
 * Why a watermark and not a sessions table: it needs no new table and no DB
 * write per login, and it is the same mechanism password change and reset
 * already rely on. The trade-off is that logging out signs out every device;
 * for a gift-buyer account that is the expected, safer behaviour.
 */
export async function POST(req: NextRequest) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const userId = await resolveBuyer(req);
  if (userId) await userRepo.revokeSessions(db(), userId);
  return clearSession(new NextResponse(null, { status: 204 }));
}
