import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { clientIp } from '@/lib/auth';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { analyticsEventRepo } from '@/lib/repos/analyticsEvent';
import type { ClientEventName } from '@/lib/analyticsClient';

// Only these are accepted from the browser — everything else in
// docs/analytics_events_v1.md is emitted server-side, next to the action.
const CLIENT_EVENTS = new Set<ClientEventName>(['page_viewed', 'cta_clicked']);

const LIMIT = 60;
const WINDOW_MS = 60 * 1000;

const MAX_PROP_STRING_LEN = 200;
const MAX_PROPS = 10;

/** Keeps only small scalar values — never lets a client smuggle PII/content into props. */
function sanitizeProps(props: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props || typeof props !== 'object') return out;
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    if (typeof value === 'string' && value.length <= MAX_PROP_STRING_LEN) out[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/**
 * POST /api/analytics/event
 * Body: { event_name: 'page_viewed' | 'cta_clicked', props?: {...} }
 * Public, unauthenticated, best-effort — always degrades quietly (never a 5xx
 * that would surface in a visitor's network tab) so it can never break a page.
 */
export async function POST(req: NextRequest) {
  if (req.headers.get('dnt') === '1' || req.headers.get('sec-gpc') === '1') {
    return NextResponse.json({ ok: true, persisted: false }, { status: 202 });
  }

  let body: { event_name?: string; props?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: 'bad_json', message: 'Invalid JSON.' } }, { status: 400 });
  }

  const eventName = body.event_name;
  if (typeof eventName !== 'string' || !CLIENT_EVENTS.has(eventName as ClientEventName)) {
    return NextResponse.json({ error: { code: 'invalid_event', message: 'Unknown event.' } }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: true, persisted: false }, { status: 202 });
  }

  try {
    const pool = db();
    const rl = await rateLimitRepo.hit(pool, `analytics:ip:${clientIp(req)}`, {
      limit: LIMIT,
      windowMs: WINDOW_MS,
    });
    if (!rl.allowed) {
      return NextResponse.json({ ok: true, persisted: false }, { status: 202 });
    }
    await analyticsEventRepo.record(pool, eventName, sanitizeProps(body.props));
    return NextResponse.json({ ok: true, persisted: true }, { status: 202 });
  } catch (err) {
    console.error('analytics event insert failed', err);
    return NextResponse.json({ ok: true, persisted: false }, { status: 202 });
  }
}
