import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { readJsonBody, errorToResponse, rejectCrossOrigin, clientIp } from '@/lib/auth';
import { consentRepo } from '@/lib/repos/consent';
import { ValidationError } from '@/lib/types';

/**
 * Preview an invite (public, read-only): who invited them and whose weekly
 * summary it is, so the page can ask before accepting. GET never changes
 * anything, so an email security scanner that fetches the link can't accept
 * on the recipient's behalf.
 */
export async function GET(req: NextRequest) {
  try {
    const pool = db();
    await rateLimitRepo.enforce(pool, `invitepreview:ip:${clientIp(req)}`, { limit: 30, windowMs: 15 * 60 * 1000 });
    const token = req.nextUrl.searchParams.get('token') ?? '';
    if (!token) throw new ValidationError('token is required');
    const invite = await consentRepo.previewRecipientInvite(pool, token);
    return NextResponse.json({ invite }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * Accept a summary-recipient invite (public — the sibling clicks "Yes, send
 * me weekly summaries" on the invite page; never on page load). Activates the
 * pending consent so the recipient can receive summaries.
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
