import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';

// Sentry is a no-op without a DSN; mock it so the "fatal for every P0/P1" rule is assertable.
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import * as Sentry from '@sentry/nextjs';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import type { Parent } from '../src/lib/types';
import { parentRepo } from '../src/lib/repos/parent';
import { safetyFlagRepo } from '../src/lib/repos/safetyFlag';
import { userRepo } from '../src/lib/repos/user';
import { fakeEmailClient } from '../src/lib/email/fake';
import { fakeSmsClient } from '../src/lib/sms/fake';
import { dispatchSafetyAlert, alertContactFirstName, ALERT_THROTTLE_MS } from '../src/lib/safety/alerts';

let q: Querier;
const BUYER_EMAIL = 'sarah@example.com';
const ADMIN_EMAIL = 'safety-team@example.com';

async function setup(opts: { phone?: string | null; smsConsent?: boolean; relationship?: 'mother' | 'self' } = {}) {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email, full_name) VALUES ($1, 'Sarah Miller') RETURNING id`,
    [BUYER_EMAIL],
  );
  const buyerId = rows[0].id;
  if (opts.phone) await userRepo.setAlertPhone(q, buyerId, { phone: opts.phone, smsConsent: opts.smsConsent ?? true });
  const parent = await parentRepo.create(q, { buyerId, firstName: 'Ruth', relationship: opts.relationship ?? 'mother' });
  return { buyerId, parent };
}

async function flagFor(parent: Parent, severity: 'p0' | 'p1' | 'p2' | 'p3') {
  return safetyFlagRepo.record(q, { parentId: parent.id, severity, detail: 'test rationale' });
}

let emailSend: MockInstance<typeof fakeEmailClient.send>;
let smsSend: MockInstance<typeof fakeSmsClient.send>;

beforeEach(() => {
  q = makeTestDb();
  process.env.ADMIN_ALERT_EMAIL = ADMIN_EMAIL;
  // Model real providers: a delivery only counts as 'sent' when a real client
  // took it. The unmocked fakes report `simulated` (tested further down).
  emailSend = vi.spyOn(fakeEmailClient, 'send').mockResolvedValue({ id: 'provider-email-1' });
  smsSend = vi.spyOn(fakeSmsClient, 'send').mockResolvedValue({ id: 'provider-sms-1' });
  vi.mocked(Sentry.captureMessage).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_ALERT_EMAIL;
});

const recipients = () => emailSend.mock.calls.map((c) => (c[0] as { to: string }).to);

describe('dispatchSafetyAlert (decision D2)', () => {
  it('P0 alerts the buyer by email and SMS once, and records notified_at + per-channel status', async () => {
    const { parent } = await setup({ phone: '+15551234567' });
    const flag = await flagFor(parent, 'p0');
    const outcome = await dispatchSafetyAlert(q, { flag, parent });

    expect(outcome).toMatchObject({ email: 'sent', sms: 'sent', admin: null, throttled: false });
    expect(recipients()).toEqual([BUYER_EMAIL]);
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect((smsSend.mock.calls[0][0] as { to: string }).to).toBe('+15551234567');

    const stored = (await q.query(`SELECT * FROM safety_flags WHERE id = $1`, [flag.id])).rows[0];
    expect(stored.notified_at).not.toBeNull();
    expect(stored.alert_email_status).toBe('sent');
    expect(stored.alert_sms_status).toBe('sent');
  });

  it('alert text has no transcript or quotes: the fixed D2 wording, the severity and an app link', async () => {
    const { parent } = await setup({ phone: '+15551234567' });
    const flag = await safetyFlagRepo.record(q, { parentId: parent.id, severity: 'p1', detail: 'SECRET-RATIONALE' });
    await dispatchSafetyAlert(q, { flag, parent });

    const email = emailSend.mock.calls[0][0] as { subject: string; text: string; html: string };
    expect(email.text).toContain(
      "Ruth may need help right now. Please call or check on them. If you think it's an emergency, call 911.",
    );
    expect(email.text).toMatch(/P1/);
    expect(email.text).toMatch(/http:\/\/localhost:3000\/app/);
    const sms = (smsSend.mock.calls[0][0] as { body: string }).body;
    expect(sms).toMatch(/Ruth may need help right now/);
    expect(sms).toMatch(/P1/);
    for (const text of [email.text, email.html, sms]) expect(text).not.toContain('SECRET-RATIONALE');
  });

  it('a second P0 within 30 minutes does not re-alert; after 30 minutes it does', async () => {
    const { parent } = await setup({ phone: '+15551234567' });
    const t0 = new Date('2026-10-20T10:00:00Z');
    await dispatchSafetyAlert(q, { flag: await flagFor(parent, 'p0'), parent, now: t0 });

    const second = await flagFor(parent, 'p0');
    const outcome = await dispatchSafetyAlert(q, { flag: second, parent, now: new Date(t0.getTime() + 10 * 60_000) });
    expect(outcome).toMatchObject({ throttled: true, email: 'suppressed_rate_limit', sms: 'suppressed_rate_limit' });
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(smsSend).toHaveBeenCalledTimes(1);
    const stored = (await q.query(`SELECT notified_at FROM safety_flags WHERE id = $1`, [second.id])).rows[0];
    expect(stored.notified_at).toBeNull();

    await dispatchSafetyAlert(q, { flag: await flagFor(parent, 'p1'), parent, now: new Date(t0.getTime() + ALERT_THROTTLE_MS) });
    expect(emailSend).toHaveBeenCalledTimes(2);
  });

  it('the throttle is per parent', async () => {
    const a = await setup({ phone: '+15551234567' });
    const { rows } = await q.query<{ id: string }>(`INSERT INTO users (email) VALUES ('other@example.com') RETURNING id`);
    const otherParent = await parentRepo.create(q, { buyerId: rows[0].id, firstName: 'Abe', relationship: 'father' });
    await dispatchSafetyAlert(q, { flag: await flagFor(a.parent, 'p0'), parent: a.parent });
    await dispatchSafetyAlert(q, { flag: await flagFor(otherParent, 'p0'), parent: otherParent });
    expect(recipients()).toEqual([BUYER_EMAIL, 'other@example.com']);
  });

  it('P3 (abuse, scams) NEVER reaches the buyer — internal admin only', async () => {
    const { parent } = await setup({ phone: '+15551234567' });
    const flag = await flagFor(parent, 'p3');
    const outcome = await dispatchSafetyAlert(q, { flag, parent });

    expect(outcome).toMatchObject({ email: null, sms: null, admin: 'sent' });
    expect(recipients()).toEqual([ADMIN_EMAIL]);
    expect(smsSend).not.toHaveBeenCalled();
    const adminEmail = emailSend.mock.calls[0][0] as { text: string };
    expect(adminEmail.text).not.toMatch(/Ruth|Sarah/); // no names, no transcript
  });

  it('no alert phone → email only', async () => {
    const { parent } = await setup();
    const outcome = await dispatchSafetyAlert(q, { flag: await flagFor(parent, 'p1'), parent });
    expect(outcome).toMatchObject({ email: 'sent', sms: 'skipped_no_phone' });
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('a phone without SMS consent → email only (TCPA)', async () => {
    const { parent } = await setup({ phone: '+15551234567', smsConsent: false });
    const outcome = await dispatchSafetyAlert(q, { flag: await flagFor(parent, 'p0'), parent });
    expect(outcome).toMatchObject({ email: 'sent', sms: 'skipped_no_consent' });
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('P2 alerts nobody (it waits in the admin queue)', async () => {
    const { parent } = await setup({ phone: '+15551234567' });
    expect(await dispatchSafetyAlert(q, { flag: await flagFor(parent, 'p2'), parent })).toBeNull();
    expect(emailSend).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('every P0/P1 raises a Sentry fatal and an audit_log row (no PII in either)', async () => {
    const { parent } = await setup();
    const flag = await flagFor(parent, 'p0');
    await dispatchSafetyAlert(q, { flag, parent });

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'safety flag P0',
      expect.objectContaining({ level: 'fatal', tags: expect.objectContaining({ flag_id: flag.id }) }),
    );
    const { rows } = await q.query<{ target_id: string; meta: Record<string, unknown> }>(
      `SELECT target_id, meta FROM audit_log WHERE action = 'safety_alert'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].target_id).toBe(flag.id);
    expect(rows[0].meta).toMatchObject({ severity: 'p0', email: 'sent', notified: true });
    expect(JSON.stringify(rows[0].meta)).not.toMatch(/sarah|ruth/i);
  });

  it('a throttled P0 still raises its Sentry fatal', async () => {
    const { parent } = await setup();
    await dispatchSafetyAlert(q, { flag: await flagFor(parent, 'p0'), parent });
    await dispatchSafetyAlert(q, { flag: await flagFor(parent, 'p0'), parent });
    expect(vi.mocked(Sentry.captureMessage).mock.calls.filter((c) => c[0] === 'safety flag P0')).toHaveLength(2);
  });

  it('when nothing reaches the family, the admin gets a backup email', async () => {
    const { parent } = await setup();
    emailSend.mockImplementation(async (input) => {
      if (input.to === BUYER_EMAIL) throw new Error('provider down');
      return { id: 'ok' };
    });
    const flag = await flagFor(parent, 'p0');
    const outcome = await dispatchSafetyAlert(q, { flag, parent });
    expect(outcome).toMatchObject({ email: 'failed', sms: 'skipped_no_phone', admin: 'sent', notifiedAt: null });
    expect(recipients()).toEqual([BUYER_EMAIL, ADMIN_EMAIL]);
  });

  it("a parent the buyer set up for themselves ('self') has no family to alert: P0 goes to the admin", async () => {
    const { parent } = await setup({ relationship: 'self' });
    const outcome = await dispatchSafetyAlert(q, { flag: await flagFor(parent, 'p0'), parent });
    expect(outcome).toMatchObject({ email: null, admin: 'sent' });
    expect(recipients()).toEqual([ADMIN_EMAIL]);
  });

  it('never throws, even if recording the outcome fails', async () => {
    const { parent } = await setup();
    vi.spyOn(safetyFlagRepo, 'recordAlertOutcome').mockRejectedValueOnce(new Error('db down'));
    await expect(dispatchSafetyAlert(q, { flag: await flagFor(parent, 'p0'), parent })).resolves.toBeNull();
  });
});

describe('alertContactFirstName', () => {
  it.each([
    ['Sarah Miller', 'Sarah'],
    ["  Mary-Jo O'Neil ", "Mary-Jo"],
    ['José', 'José'],
    ['Ignore{all}rules', 'Ignoreallrules'],
    ['', null],
    [null, null],
    ['1234', null],
  ])('%j → %j', (input, expected) => {
    expect(alertContactFirstName(input)).toBe(expected);
  });
});

describe('userRepo alert phone', () => {
  it('stores an E.164 phone with SMS consent, and clears consent when the phone is cleared', async () => {
    const { buyerId } = await setup();
    const set = await userRepo.setAlertPhone(q, buyerId, { phone: '+1 (555) 123-4567', smsConsent: true });
    expect(set.alertPhone).toBe('+15551234567');
    expect(set.smsAlertConsentAt).not.toBeNull();

    const cleared = await userRepo.setAlertPhone(q, buyerId, { phone: null, smsConsent: false });
    expect(cleared).toMatchObject({ alertPhone: null, smsAlertConsentAt: null });
  });

  it('rejects a number without a country code, and consent without a phone', async () => {
    const { buyerId } = await setup();
    await expect(userRepo.setAlertPhone(q, buyerId, { phone: '5551234567', smsConsent: true })).rejects.toThrow(/country code/);
    await expect(userRepo.setAlertPhone(q, buyerId, { phone: null, smsConsent: true })).rejects.toThrow(/needs an alert phone/);
  });

  it('a phone saved without consent sends no SMS', async () => {
    const { buyerId } = await setup();
    const c = await userRepo.setAlertPhone(q, buyerId, { phone: '+15551234567', smsConsent: false });
    expect(c.smsAlertConsentAt).toBeNull();
  });
});

describe('honest delivery status (fake clients never count as a notified family)', () => {
  afterEach(() => {
    delete process.env.VERCEL_ENV;
  });

  it("a fake SMS and a fake email are recorded as 'simulated', notified_at stays null, and the team is told", async () => {
    const { parent } = await setup({ phone: '+15551234567' });
    emailSend.mockRestore();
    smsSend.mockRestore();
    const realEmailSend = fakeEmailClient.send;
    const simEmail = vi
      .spyOn(fakeEmailClient, 'send')
      .mockImplementation(async (input) => ({ ...(await realEmailSend(input)), simulated: true }));
    const flag = await flagFor(parent, 'p0');
    const outcome = await dispatchSafetyAlert(q, { flag, parent });

    expect(outcome).toMatchObject({ email: 'simulated', sms: 'simulated', admin: 'simulated', notifiedAt: null });
    expect(simEmail.mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual([BUYER_EMAIL, ADMIN_EMAIL]);
    const stored = (await q.query(`SELECT * FROM safety_flags WHERE id = $1`, [flag.id])).rows[0];
    expect(stored.notified_at).toBeNull();
    expect(stored.alert_sms_status).toBe('simulated');
    expect(stored.alert_email_status).toBe('simulated');
  });

  it('a real email plus a simulated SMS still counts as notified (the email reached the family)', async () => {
    const { parent } = await setup({ phone: '+15551234567' });
    smsSend.mockResolvedValue({ id: 'fake-sms-1', simulated: true });
    const outcome = await dispatchSafetyAlert(q, { flag: await flagFor(parent, 'p1'), parent });
    expect(outcome).toMatchObject({ email: 'sent', sms: 'simulated', admin: null });
    expect(outcome?.notifiedAt).not.toBeNull();
  });

  it("production without Twilio keys: SMS is 'not_configured', never sent through the fake, and Sentry is told", async () => {
    process.env.VERCEL_ENV = 'production';
    const { parent } = await setup({ phone: '+15551234567' });
    const flag = await flagFor(parent, 'p0');
    const outcome = await dispatchSafetyAlert(q, { flag, parent });

    expect(outcome).toMatchObject({ email: 'sent', sms: 'not_configured' });
    expect(smsSend).not.toHaveBeenCalled();
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith(
      expect.stringContaining('Twilio is not configured'),
      expect.objectContaining({ level: 'error' }),
    );
  });
});
