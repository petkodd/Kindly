import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { readJsonBody, errorToResponse, rejectCrossOrigin, clientIp } from '@/lib/auth';
import { consentRepo } from '@/lib/repos/consent';
import { ValidationError } from '@/lib/types';

/**
 * Accept a summary-recipient invite (public — the sibling clicks an emailed
 * link). Activates the pending consent so the recipient can receive summaries.
 */
export async function POST(req: NextRequest) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  try {
    const pool = db();
    // Unauthenticated token lookup: throttle per IP (guessing is infeasible; this blunts hammering).
    await rateLimitRepo.enforce(pool, `inviteaccept:ip:${clientIp(req)}`, { limit: 20, windowMs: 15 * 60 * 1000 });
    const body = await readJsonBody(req);
    const token = body.token as string;
    if (!token) throw new ValidationError('token is required');
    await consentRepo.acceptRecipientInvite(pool, token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
