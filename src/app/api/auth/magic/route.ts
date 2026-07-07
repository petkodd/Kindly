import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { magicLinkRepo } from '@/lib/repos/magicLink';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { getEmailClient } from '@/lib/email';
import { magicLinkEmail } from '@/lib/email/templates';
import { SITE } from '@/lib/seo';
import { RateLimitError } from '@/lib/types';

// Unauthenticated + triggers an email send — throttle per IP the same way login does.
const MAGIC_LIMIT = 5;
const MAGIC_WINDOW_MS = 15 * 60 * 1000;

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Send a magic sign-in link. ALWAYS returns 200 — never reveals whether the
 * email is registered (no user enumeration). Email delivery failure is
 * logged but doesn't change the response, same rationale as the invite flow.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const rl = await rateLimitRepo.hit(pool, `magic:ip:${clientIp(req)}`, {
      limit: MAGIC_LIMIT,
      windowMs: MAGIC_WINDOW_MS,
    });
    if (!rl.allowed) throw new RateLimitError('Too many requests. Please try again later.');

    const body = await readJsonBody(req);
    const email = (body.email as string) ?? '';
    const user = await userRepo.findByEmail(pool, email);
    if (user) {
      const { token } = await magicLinkRepo.issue(pool, user.id);
      const verifyUrl = `${SITE.url}/login/verify?token=${token}`;
      const { subject, html, text } = magicLinkEmail({ verifyUrl });
      try {
        await getEmailClient().send({ to: user.email, subject, html, text });
      } catch (err) {
        console.error('magic link email delivery failed', err);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
