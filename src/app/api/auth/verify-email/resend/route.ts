import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { magicLinkRepo, LINK_TTL_MS } from '@/lib/repos/magicLink';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { getEmailClient } from '@/lib/email';
import { verifyEmailEmail } from '@/lib/email/templates';
import { SITE } from '@/lib/seo';

/** Resend the email-confirmation link to the signed-in buyer (3 per hour). */
export async function POST(req: NextRequest) {
  const userId = await resolveBuyer(req);
  if (!userId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    const account = await userRepo.getAccount(pool, userId);
    if (account.email_verified_at) return NextResponse.json({ ok: true, already_verified: true });
    await rateLimitRepo.enforce(pool, `verifyresend:${userId}`, {
      limit: 3,
      windowMs: 60 * 60 * 1000,
      message: 'We’ve sent a few links already. Please check your inbox (and spam folder) or try again in an hour.',
    });
    const { token } = await magicLinkRepo.issue(pool, userId, { purpose: 'login', ttlMs: LINK_TTL_MS.signupVerify });
    await getEmailClient().send({ to: account.email, ...verifyEmailEmail({ verifyUrl: `${SITE.url}/login/verify?token=${token}` }) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
