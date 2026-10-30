import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse, clientIp, rejectCrossOrigin } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { magicLinkRepo, LINK_TTL_MS } from '@/lib/repos/magicLink';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { analyticsEventRepo } from '@/lib/repos/analyticsEvent';
import { getEmailClient } from '@/lib/email';
import { accountExistsEmail, verifyEmailEmail } from '@/lib/email/templates';
import { SITE } from '@/lib/seo';

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
      email = verifyEmailEmail({ verifyUrl: `${SITE.url}/login/verify?token=${token}` });
      await analyticsEventRepo.record(pool, 'account_created', { method: 'password' }, { userId: outcome.user.id });
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
