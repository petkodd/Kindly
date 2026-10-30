import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse, clientIp, rejectCrossOrigin, householdFingerprint } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { magicLinkRepo, LINK_TTL_MS } from '@/lib/repos/magicLink';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { analyticsEventRepo } from '@/lib/repos/analyticsEvent';
import { getEmailClient } from '@/lib/email';
import { accountExistsEmail, verifyEmailEmail } from '@/lib/email/templates';
import { SITE } from '@/lib/seo';
import { safeNextPath } from '@/lib/nextPath';
import { referralRepo } from '@/lib/repos/referral';
import { normalizeReferralCode, REF_COOKIE } from '@/lib/referralCode';
import type { Querier } from '@/lib/querier';

/**
 * Create a buyer account WITHOUT revealing whether the email is registered.
 *
 * Both outcomes get the identical 202 `{ ok: true, next: 'check_email' }`, no
 * session cookie, and roughly the same work (the password is hashed either
 * way; one email is sent either way):
 * - new email → the account is created (unverified) and a confirmation link
 *   is emailed; clicking it verifies the address and signs them in;
 * - existing email → nothing changes on that account; its owner is emailed a
 *   "you already have an account — sign in or reset your password" note.
 * Validation errors (bad email, short password) are the same for everyone.
 *
 * An optional `next` (validated by safeNextPath — same-site /app or /admin
 * paths only) rides along in the confirmation link, so a buyer who started
 * from "Set up the gift" lands back in onboarding after confirming.
 *
 * An optional `referral_code` (or the ?ref= cookie, see src/lib/referralCode.ts)
 * is redeemed for a NEWLY created account only (chat 11). The outcome is never
 * reflected in the response: an invalid or used code looks exactly like a
 * good one, so neither codes nor accounts can be probed through signup. The
 * buyer sees the result later on the onboarding checkout step.
 */
export async function POST(req: NextRequest) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  try {
    const pool = db();
    await rateLimitRepo.enforce(pool, `signup:ip:${clientIp(req)}`, {
      limit: 10,
      windowMs: 60 * 60 * 1000,
      message: 'Too many sign-up attempts from here. Please try again in an hour.',
    });
    const body = await readJsonBody(req);
    const outcome = await userRepo.signup(pool, { email: body.email as string, password: body.password as string });

    let email;
    let to: string;
    if (outcome.created) {
      to = outcome.user.email;
      const { token } = await magicLinkRepo.issue(pool, outcome.user.id, { purpose: 'login', ttlMs: LINK_TTL_MS.signupVerify });
      const next = safeNextPath(body.next);
      const nextParam = next ? `&next=${encodeURIComponent(next)}` : '';
      email = verifyEmailEmail({ verifyUrl: `${SITE.url}/login/verify?token=${token}${nextParam}` });
      await analyticsEventRepo.record(pool, 'account_created', { method: 'password' }, { userId: outcome.user.id });
      const referralCode =
        normalizeReferralCode(body.referral_code) ?? normalizeReferralCode(req.cookies.get(REF_COOKIE)?.value);
      if (referralCode) await redeemQuietly(pool, req, outcome.user.id, referralCode);
    } else {
      to = outcome.existing.email;
      email = accountExistsEmail({ loginUrl: `${SITE.url}/login`, resetUrl: `${SITE.url}/login/forgot` });
    }
    try {
      await getEmailClient().send({ to, ...email });
    } catch (err) {
      // Never reveal delivery problems (they'd differ between the two cases).
      console.error('signup email delivery failed', (err as Error).name);
    }
    return NextResponse.json({ ok: true, next: 'check_email' }, { status: 202 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** Same per-IP limit as POST /api/referrals/redeem (shared key), then redeem; every failure is swallowed. */
async function redeemQuietly(pool: Querier, req: NextRequest, userId: string, code: string): Promise<void> {
  try {
    const ip = clientIp(req);
    const rl = await rateLimitRepo.hit(pool, `referral:ip:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) return;
    await referralRepo.redeem(pool, code, { redeemerId: userId, householdHash: householdFingerprint(ip) });
  } catch (err) {
    console.error('signup referral redeem skipped', (err as Error).name);
  }
}
