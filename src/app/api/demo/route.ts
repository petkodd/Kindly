import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { clientIp, rejectCrossOrigin } from '@/lib/auth';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { waitlistRepo } from '@/lib/repos/waitlist';

/**
 * POST /api/demo
 * Body: { email, source_page?, utm? }
 * Upserts a waitlist signup with wants_demo = true. Emits a server-side
 * analytics event. 201 on success; idempotent (re-request for same email
 * is a no-op beyond setting wants_demo).
 */
export async function POST(req: NextRequest) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  let body: { email?: string; source_page?: string; utm?: unknown };
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
    const { allowed } = await rateLimitRepo.hit(db(), `demo:ip:${clientIp(req)}`, { limit: 5, windowMs: 60 * 60 * 1000 });
    if (!allowed) {
      return NextResponse.json(
        { error: { code: 'rate_limited', message: 'Too many requests. Please try again in a little while.' } },
        { status: 429 },
      );
    }
    await waitlistRepo.requestDemo(db(), {
      email,
      sourcePage: body.source_page,
      utm: body.utm,
    });
    return NextResponse.json({ ok: true, persisted: true }, { status: 201 });
  } catch (err) {
    console.error('demo insert failed', err);
    return NextResponse.json(
      { error: { code: 'server_error', message: 'Could not save request.' } },
      { status: 500 },
    );
  }
}
