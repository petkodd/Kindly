import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { db } from '@/lib/db';
import { clientIp, rejectCrossOrigin } from '@/lib/auth';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { demoRequestRepo, type SalesAlertStatus } from '@/lib/repos/demoRequest';
import { demoRoleLabel, validateDemoRequest, type DemoRequest } from '@/lib/demoRequest';
import { getEmailClient } from '@/lib/email';
import { salesDemoRequestEmail } from '@/lib/email/templates';

/**
 * POST /api/demo — facility demo request from the senior-living page (chat 13).
 * Body: { facility_name, residents, role, name, email, phone?, source_page? }
 *
 * Origin-checked and rate-limited per IP (5/hour). Stores the request
 * (facility_demo_requests) and emails it to SALES_ALERT_EMAIL. The visitor
 * always gets 201 once the request is stored: a missing or failing sales
 * mailbox is recorded on the row and raised in Sentry, never shown to them.
 * 400 { error: { code: 'invalid', fields } } lists every invalid field.
 */
export async function POST(req: NextRequest) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== 'object') throw new Error('not an object');
  } catch {
    return NextResponse.json({ error: { code: 'bad_json', message: 'Invalid JSON.' } }, { status: 400 });
  }

  const checked = validateDemoRequest(body);
  if (!checked.ok) {
    return NextResponse.json(
      { error: { code: 'invalid', message: 'Please check the highlighted fields.', fields: checked.errors } },
      { status: 400 },
    );
  }
  const sourcePage = cleanSourcePage(body.source_page);

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: true, persisted: false }, { status: 201 });
  }

  try {
    // Public form: throttle per IP so it can't be used to flood the table or the sales inbox.
    const { allowed } = await rateLimitRepo.hit(db(), `demo:ip:${clientIp(req)}`, { limit: 5, windowMs: 60 * 60 * 1000 });
    if (!allowed) {
      return NextResponse.json(
        { error: { code: 'rate_limited', message: 'Too many requests. Please try again in a little while.' } },
        { status: 429 },
      );
    }
    const { id } = await demoRequestRepo.create(db(), { ...checked.value, sourcePage });
    const status = await notifySales(checked.value, sourcePage, id);
    await demoRequestRepo.setSalesAlert(db(), id, status);
    return NextResponse.json({ ok: true, persisted: true }, { status: 201 });
  } catch (err) {
    console.error('demo request failed', err);
    return NextResponse.json(
      { error: { code: 'server_error', message: 'Could not save your request. Please try again.' } },
      { status: 500 },
    );
  }
}

function cleanSourcePage(v: unknown): string | null {
  return typeof v === 'string' && /^\/[\w\-/]{0,199}$/.test(v) ? v : null;
}

async function notifySales(r: DemoRequest, sourcePage: string | null, id: string): Promise<SalesAlertStatus> {
  const to = process.env.SALES_ALERT_EMAIL;
  if (!to) {
    Sentry.captureMessage('demo request: SALES_ALERT_EMAIL is not set', { level: 'error', tags: { area: 'demo_request', id } });
    return 'not_configured';
  }
  try {
    const result = await getEmailClient().send({
      to,
      ...salesDemoRequestEmail({ ...r, roleLabel: demoRoleLabel(r.role), sourcePage }),
    });
    return (result as { simulated?: boolean }).simulated ? 'simulated' : 'sent';
  } catch (err) {
    console.error('demo request: sales email failed', id, err);
    Sentry.captureException(err, { tags: { area: 'demo_request', id } });
    return 'failed';
  }
}
