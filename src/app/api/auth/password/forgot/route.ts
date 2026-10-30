import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse, clientIp, rejectCrossOrigin } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { magicLinkRepo } from '@/lib/repos/magicLink';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { getEmailClient } from '@/lib/email';
import { passwordResetEmail } from '@/lib/email/templates';
import { SITE } from '@/lib/seo';

/**
 * "Forgot password?": email a single-use, 30-minute reset link. ALWAYS 200
 * `{ ok: true }` — never reveals whether the email has an account. Throttled
 * per IP and per email (so it can't be used to flood someone's inbox).
 */
export async function POST(req: NextRequest) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  try {
    const pool = db();
    const body = await readJsonBody(req);
    const email = typeof body.email === 'string' ? body.email : '';
    const emailKey = createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
    const message = 'Too many reset requests. Please try again a little later.';
    await rateLimitRepo.enforce(pool, `forgot:ip:${clientIp(req)}`, { limit: 10, windowMs: 15 * 60 * 1000, message });
    await rateLimitRepo.enforce(pool, `forgot:email:${emailKey}`, { limit: 3, windowMs: 60 * 60 * 1000, message });

    const user = await userRepo.findByEmail(pool, email);
    if (user) {
      const { token } = await magicLinkRepo.issue(pool, user.id, { purpose: 'reset' });
      const mail = passwordResetEmail({ resetUrl: `${SITE.url}/login/reset?token=${token}` });
      try {
        await getEmailClient().send({ to: user.email, ...mail });
      } catch (err) {
        console.error('password reset email delivery failed', (err as Error).name);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
