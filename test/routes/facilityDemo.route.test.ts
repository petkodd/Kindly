import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import type { EmailClient } from '../../src/lib/email';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

import * as Sentry from '@sentry/nextjs';
import { POST as demoPOST } from '../../src/app/api/demo/route';
import { fakeEmailClient, resetEmailClient } from '../../src/lib/email';
import { salesDemoRequestEmail } from '../../src/lib/email/templates';
import { validateDemoRequest } from '../../src/lib/demoRequest';

const VALID = {
  facility_name: 'Maple Grove Senior Living',
  residents: '48',
  role: 'life_enrichment',
  name: 'Dana Ruiz',
  email: 'Dana@MapleGrove.example',
  phone: '(555) 234-5678',
  source_page: '/senior-living',
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  demoPOST(
    new NextRequest('http://localhost/api/demo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );

let send: MockInstance<EmailClient["send"]>;

beforeEach(() => {
  q = makeTestDb();
  process.env.DATABASE_URL = 'postgres://test';
  process.env.SALES_ALERT_EMAIL = 'sales@dearly.example';
  resetEmailClient();
  send = vi.spyOn(fakeEmailClient, 'send');
  vi.mocked(Sentry.captureMessage).mockClear();
  vi.mocked(Sentry.captureException).mockClear();
});

afterEach(() => {
  send.mockRestore();
  delete process.env.SALES_ALERT_EMAIL;
});

describe('validateDemoRequest (shared by the form and /api/demo)', () => {
  it('accepts a complete request and normalizes it', () => {
    const r = validateDemoRequest(VALID);
    expect(r).toEqual({
      ok: true,
      value: {
        facilityName: 'Maple Grove Senior Living',
        residents: 48,
        role: 'life_enrichment',
        name: 'Dana Ruiz',
        email: 'dana@maplegrove.example',
        phone: '+15552345678',
      },
    });
  });

  it('phone is optional', () => {
    const r = validateDemoRequest({ ...VALID, phone: '  ' });
    expect(r.ok && r.value.phone).toBeNull();
  });

  it('reports every invalid field at once', () => {
    const r = validateDemoRequest({ facility_name: '', residents: '0', role: 'ceo', name: '', email: 'a@b', phone: '123' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['email', 'facility_name', 'name', 'phone', 'residents', 'role']);
  });

  it.each(['abc', '12.5', '-3', '5001'])('rejects residents = %s', (residents) => {
    expect(validateDemoRequest({ ...VALID, residents }).ok).toBe(false);
  });

  it('rejects over-long names and non-US phone numbers', () => {
    expect(validateDemoRequest({ ...VALID, facility_name: 'x'.repeat(201) }).ok).toBe(false);
    expect(validateDemoRequest({ ...VALID, name: 'x'.repeat(121) }).ok).toBe(false);
    expect(validateDemoRequest({ ...VALID, phone: '+44 20 7946 0958' }).ok).toBe(false);
  });
});

describe('POST /api/demo (chat 13)', () => {
  it('stores the request and emails SALES_ALERT_EMAIL with every field', async () => {
    const res = await post(VALID);
    expect(res.status).toBe(201);

    const { rows } = await q.query<Record<string, unknown>>(`SELECT * FROM facility_demo_requests`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      facility_name: 'Maple Grove Senior Living',
      residents: 48,
      contact_role: 'life_enrichment',
      contact_name: 'Dana Ruiz',
      email: 'dana@maplegrove.example',
      phone: '+15552345678',
      source_page: '/senior-living',
      sales_alert: 'simulated', // fake email client locally — never 'sent'
    });

    expect(send).toHaveBeenCalledOnce();
    const mail = send.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(mail.to).toBe('sales@dearly.example');
    expect(mail.subject).toBe('[Dearly sales] Demo request: Maple Grove Senior Living (48 residents)');
    for (const v of ['Maple Grove Senior Living', '48', 'Life enrichment / activities', 'Dana Ruiz', 'dana@maplegrove.example', '+15552345678']) {
      expect(mail.text).toContain(v);
    }
  });

  it('records a real provider delivery as sent', async () => {
    send.mockResolvedValueOnce({ id: 'provider-1' });
    expect((await post(VALID)).status).toBe(201);
    const { rows } = await q.query<{ sales_alert: string }>(`SELECT sales_alert FROM facility_demo_requests`);
    expect(rows[0].sales_alert).toBe('sent');
  });

  it('still accepts the request when SALES_ALERT_EMAIL is unset — stored as not_configured, Sentry error', async () => {
    delete process.env.SALES_ALERT_EMAIL;
    expect((await post(VALID)).status).toBe(201);
    expect(send).not.toHaveBeenCalled();
    const { rows } = await q.query<{ sales_alert: string }>(`SELECT sales_alert FROM facility_demo_requests`);
    expect(rows[0].sales_alert).toBe('not_configured');
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith('demo request: SALES_ALERT_EMAIL is not set', expect.anything());
  });

  it('a failing email provider does not lose the request', async () => {
    send.mockRejectedValueOnce(new Error('provider down'));
    expect((await post(VALID)).status).toBe(201);
    const { rows } = await q.query<{ sales_alert: string }>(`SELECT sales_alert FROM facility_demo_requests`);
    expect(rows[0].sales_alert).toBe('failed');
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledOnce();
  });

  it('400 lists the invalid fields and stores nothing', async () => {
    const res = await post({ ...VALID, residents: 'lots', role: '' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid');
    expect(Object.keys(body.error.fields).sort()).toEqual(['residents', 'role']);
    const { rows } = await q.query(`SELECT 1 FROM facility_demo_requests`);
    expect(rows).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores a source_page that is not a plain path', async () => {
    await post({ ...VALID, source_page: 'https://evil.example/<script>' });
    const { rows } = await q.query<{ source_page: string | null }>(`SELECT source_page FROM facility_demo_requests`);
    expect(rows[0].source_page).toBeNull();
  });

  it('is rate-limited per IP (5/hour) and refuses cross-site posts', async () => {
    const ip = { 'x-forwarded-for': '9.9.9.9' };
    for (let i = 0; i < 5; i++) expect((await post({ ...VALID, email: `d${i}@example.com` }, ip)).status).toBe(201);
    expect((await post(VALID, ip)).status).toBe(429);
    expect((await post(VALID, { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('logs a PII-free analytics event', async () => {
    await post(VALID);
    const { rows } = await q.query<{ props: unknown }>(`SELECT props FROM analytics_events WHERE event_name = 'demo_requested'`);
    expect(rows).toHaveLength(1);
    const props = JSON.stringify(rows[0].props);
    expect(props).not.toMatch(/Dana|maplegrove|5552345678/i);
  });
});

describe('salesDemoRequestEmail', () => {
  const base = { facilityName: 'Oak', residents: 10, roleLabel: 'Other', name: 'N', email: 'n@example.com', phone: null, sourcePage: null };

  it('escapes visitor-supplied fields in the HTML part', () => {
    const mail = salesDemoRequestEmail({ ...base, facilityName: '<img src=x onerror=alert(1)>', name: '"Bob" & co' });
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;img');
    expect(mail.html).toContain('&quot;Bob&quot; &amp; co');
  });

  it('keeps the subject on one line (no header injection)', () => {
    const mail = salesDemoRequestEmail({ ...base, facilityName: 'Oak\r\nBcc: victim@example.com' });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text).toContain('Phone: not given');
  });
});
