import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { clientIp, rejectCrossOrigin } from '@/lib/auth';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { waitlistRepo } from '@/lib/repos/waitlist';

/**
 * POST /api/waitlist
 * Body: { email, source_page?, utm?, wants_demo? }
 * Creates a deduped waitlist signup. Emits a server-side analytics event.
 * Acceptance: 201 on create; dedupe by email; no PII beyond email + utm.
 */
export async function POST(req: NextRequest) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  let body: { email?: string; source_page?: string; utm?: unknown; wants_demo?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: 'bad_json', message: 'Invalid JSON.' } }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email.includes('@') || email.length > 320) {
    return NextResponse.json(
      { error: { code: 'invalid_email', message: 'A valid email is required.' } },
      { status: 400 },
    );
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: true, persisted: false }, { status: 201 });
  }

  try {
    // Public form: throttle per IP so it can't be used to flood the list or our inbox.
    const { allowed } = await rateLimitRepo.hit(db(), `waitlist:ip:${clientIp(req)}`, { limit: 10, windowMs: 60 * 60 * 1000 });
    if (!allowed) {
      return NextResponse.json(
        { error: { code: 'rate_limited', message: 'Too many requests. Please try again in a little while.' } },
        { status: 429 },
      );
    }
    await waitlistRepo.signup(db(), {
      email,
      sourcePage: body.source_page,
      utm: body.utm,
      wantsDemo: body.wants_demo,
    });
    return NextResponse.json({ ok: true, persisted: true }, { status: 201 });
  } catch (err) {
    console.error('waitlist insert failed', err);
    return NextResponse.json(
      { error: { code: 'server_error', message: 'Could not save signup.' } },
      { status: 500 },
    );
  }
}
