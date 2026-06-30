import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * POST /api/waitlist
 * Body: { email, source_page?, utm?, wants_demo? }
 * Creates a deduped waitlist signup. Emits a server-side analytics event.
 * Acceptance: 201 on create; dedupe by email; no PII beyond email + utm.
 */
export async function POST(req: NextRequest) {
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

  // If DATABASE_URL is not configured (local scaffold), accept gracefully.
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: true, persisted: false }, { status: 201 });
  }

  try {
    const pool = db();
    await pool.query(
      `INSERT INTO waitlist_signups (email, source_page, utm, wants_demo)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [email, body.source_page ?? null, body.utm ? JSON.stringify(body.utm) : null, !!body.wants_demo],
    );
    await pool.query(
      `INSERT INTO analytics_events (event_name, props) VALUES ($1, $2)`,
      ['waitlist_joined', JSON.stringify({ source_page: body.source_page ?? null, wants_demo: !!body.wants_demo })],
    );
    return NextResponse.json({ ok: true, persisted: true }, { status: 201 });
  } catch (err) {
    console.error('waitlist insert failed', err);
    return NextResponse.json(
      { error: { code: 'server_error', message: 'Could not save signup.' } },
      { status: 500 },
    );
  }
}
