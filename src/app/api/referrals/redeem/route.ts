import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, readJsonBody, errorToResponse, clientIp, householdFingerprint } from '@/lib/auth';
import { referralRepo } from '@/lib/repos/referral';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { RateLimitError, ValidationError } from '@/lib/types';

// Throttle redemption attempts per IP the same way login/magic-link do — the
// household guard alone doesn't stop a script from hammering codes.
const REDEEM_LIMIT = 5;
const REDEEM_WINDOW_MS = 60 * 60 * 1000;

/**
 * Redeem a referral code. The redeemer is the signed-in buyer (redemption
 * happens right after signup, when a session already exists). Fraud-guarded by
 * household in the repo — `household_hash` is derived SERVER-SIDE from the
 * caller's IP (see householdFingerprint) and is never taken from the request
 * body, since a client-supplied value could be spoofed per call to bypass the
 * one-redemption-per-household guard.
 */
export async function POST(req: NextRequest) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    const ip = clientIp(req);
    const rl = await rateLimitRepo.hit(pool, `referral:ip:${ip}`, {
      limit: REDEEM_LIMIT,
      windowMs: REDEEM_WINDOW_MS,
    });
    if (!rl.allowed) throw new RateLimitError('Too many attempts. Please try again later.');

    const body = await readJsonBody(req);
    const code = body.code as string;
    if (!code) throw new ValidationError('code is required');
    const householdHash = householdFingerprint(ip);
    await referralRepo.redeem(pool, code, { redeemerId: buyerId, householdHash });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
