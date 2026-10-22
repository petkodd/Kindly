import * as Sentry from '@sentry/nextjs';
import type { Querier } from '../querier';
import type { AlertDeliveryStatus, FlagSeverity, Parent, SafetyFlag } from '../types';
import { safetyFlagRepo } from '../repos/safetyFlag';
import { userRepo, type AlertContact } from '../repos/user';
import { auditRepo } from '../repos/audit';
import { getEmailClient } from '../email';
import { adminSafetyAlertEmail, safetyAlertEmail, safetyAlertSms } from '../email/templates';
import { getSmsClient } from '../sms';
import { getAppBaseUrl } from '../appUrl';

/**
 * Safety alerting, decision D2 (claude/kindly-decisions.md):
 * - P0 (self-harm) and P1 (medical emergency) alert the parent's gift buyer by
 *   email, and by SMS when they have an alert phone with SMS consent.
 * - At most one family alert per parent per 30 minutes.
 * - P3 (abuse, neglect, scams) NEVER goes to family — the person causing harm
 *   may be family. It goes to the internal admin (ADMIN_ALERT_EMAIL) only.
 * - Every P0/P1 also raises a Sentry fatal and writes an audit_log row, so the
 *   team can see whether the family alert was delivered.
 * - Alerts never include a transcript or quotes.
 *
 * dispatchSafetyAlert never throws: a failed alert must not break the
 * companion's reply. Failures are recorded on the flag and sent to Sentry.
 */

export const ALERT_THROTTLE_MS = 30 * 60 * 1000;

const SHORT: Record<FlagSeverity, 'p0' | 'p1' | 'p2' | 'p3'> = {
  p0_crisis: 'p0',
  p1_acute_medical: 'p1',
  p2_welfare: 'p2',
  p3_abuse: 'p3',
};

export interface AlertOutcome {
  severity: 'p0' | 'p1' | 'p3';
  /** True when the family alert was skipped because one went out in the last 30 minutes. */
  throttled: boolean;
  email: AlertDeliveryStatus | null;
  sms: AlertDeliveryStatus | null;
  admin: AlertDeliveryStatus | null;
  notifiedAt: Date | null;
}

/**
 * First name to use when the companion says who is being told, taken from the
 * buyer's full name. Letters, apostrophes and hyphens only, so a name can't
 * smuggle instructions into the prompt. Null when there's nothing usable.
 */
export function alertContactFirstName(fullName: string | null | undefined): string | null {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/[^\p{L}'-]/gu, '').slice(0, 40);
  return clean.length > 0 ? clean : null;
}

/**
 * The buyer who would be alerted for this parent, or null when no family
 * alert would go out: the buyer set Dearly up for themselves
 * (relationship 'self'), or the account is gone. In those cases a P0/P1 goes
 * to the internal admin instead.
 */
export async function resolveAlertContact(q: Querier, parent: Parent): Promise<AlertContact | null> {
  if (parent.relationship === 'self') return null;
  try {
    return await userRepo.getAlertContact(q, parent.buyer_id);
  } catch (err) {
    console.error('safety alert: could not load the buyer contact', parent.id, err);
    return null;
  }
}

function appUrl(path: string): string {
  try {
    return `${getAppBaseUrl()}${path}`;
  } catch {
    return path;
  }
}

async function sendAdminEmail(
  flag: SafetyFlag,
  severity: 'p0' | 'p1' | 'p3',
  reason: string,
): Promise<AlertDeliveryStatus> {
  const to = process.env.ADMIN_ALERT_EMAIL;
  if (!to) {
    Sentry.captureMessage('safety alert: ADMIN_ALERT_EMAIL is not set', {
      level: 'error',
      tags: { area: 'safety_alert', flag_id: flag.id, severity },
    });
    return 'not_configured';
  }
  try {
    await getEmailClient().send({
      to,
      ...adminSafetyAlertEmail({ flagId: flag.id, severity, reason, adminUrl: appUrl('/admin') }),
    });
    return 'sent';
  } catch (err) {
    console.error('safety alert: admin email failed', flag.id, err);
    Sentry.captureException(err, { tags: { area: 'safety_alert', channel: 'admin_email', flag_id: flag.id } });
    return 'failed';
  }
}

async function alertFamily(
  q: Querier,
  flag: SafetyFlag,
  parent: Parent,
  severity: 'p0' | 'p1',
  now: Date,
): Promise<AlertOutcome> {
  const base = { severity, throttled: false, email: null, sms: null, admin: null, notifiedAt: null } as AlertOutcome;

  const contact = await resolveAlertContact(q, parent);
  if (!contact) {
    const reason =
      parent.relationship === 'self'
        ? 'the account holder set Dearly up for themselves, so there is no family contact to alert'
        : 'the family account could not be found';
    return { ...base, admin: await sendAdminEmail(flag, severity, reason) };
  }

  if (!(await safetyFlagRepo.claimAlertSlot(q, parent.id, now, ALERT_THROTTLE_MS))) {
    return { ...base, throttled: true, email: 'suppressed_rate_limit', sms: 'suppressed_rate_limit' };
  }

  const link = appUrl('/app');
  const emailPromise = getEmailClient()
    .send({ to: contact.email, ...safetyAlertEmail({ parentFirstName: parent.first_name, severity, appUrl: link }) })
    .then((): AlertDeliveryStatus => 'sent')
    .catch((err): AlertDeliveryStatus => {
      console.error('safety alert: buyer email failed', flag.id, err);
      Sentry.captureException(err, { tags: { area: 'safety_alert', channel: 'email', flag_id: flag.id } });
      return 'failed';
    });

  let smsPromise: Promise<AlertDeliveryStatus>;
  if (!contact.alertPhone) smsPromise = Promise.resolve('skipped_no_phone');
  else if (!contact.smsAlertConsentAt) smsPromise = Promise.resolve('skipped_no_consent');
  else {
    smsPromise = getSmsClient()
      .send({ to: contact.alertPhone, body: safetyAlertSms({ parentFirstName: parent.first_name, severity, appUrl: link }) })
      .then((): AlertDeliveryStatus => 'sent')
      .catch((err): AlertDeliveryStatus => {
        console.error('safety alert: buyer SMS failed', flag.id, err);
        Sentry.captureException(err, { tags: { area: 'safety_alert', channel: 'sms', flag_id: flag.id } });
        return 'failed';
      });
  }

  const [email, sms] = await Promise.all([emailPromise, smsPromise]);
  const delivered = email === 'sent' || sms === 'sent';
  // Backup: if nothing reached the family, a human on the team must know now.
  const admin = delivered ? null : await sendAdminEmail(flag, severity, 'the family alert could not be delivered');
  return { ...base, email, sms, admin, notifiedAt: delivered ? now : null };
}

/**
 * Send whatever alert this flag calls for and record the outcome on it.
 * Returns null for severities that alert nobody (P2 waits in the admin queue).
 */
export async function dispatchSafetyAlert(
  q: Querier,
  input: { flag: SafetyFlag; parent: Parent; now?: Date },
): Promise<AlertOutcome | null> {
  const { flag, parent } = input;
  const now = input.now ?? new Date();
  const severity = SHORT[flag.severity];
  if (severity === 'p2') return null;

  try {
    let outcome: AlertOutcome;
    if (severity === 'p3') {
      outcome = {
        severity,
        throttled: false,
        email: null,
        sms: null,
        admin: await sendAdminEmail(flag, severity, 'possible abuse, neglect or a scam (never sent to family)'),
        notifiedAt: null,
      };
    } else {
      // The team always hears about a P0/P1, whatever happens to the family alert.
      Sentry.captureMessage(`safety flag ${severity.toUpperCase()}`, {
        level: 'fatal',
        tags: { area: 'safety_alert', flag_id: flag.id, severity },
      });
      outcome = await alertFamily(q, flag, parent, severity, now);
    }

    await safetyFlagRepo.recordAlertOutcome(q, flag.id, {
      notifiedAt: outcome.notifiedAt,
      email: outcome.email,
      sms: outcome.sms,
      admin: outcome.admin,
    });
    await auditRepo.log(q, {
      actorId: null,
      action: 'safety_alert',
      targetType: 'safety_flag',
      targetId: flag.id,
      meta: {
        severity,
        throttled: outcome.throttled,
        email: outcome.email,
        sms: outcome.sms,
        admin: outcome.admin,
        notified: outcome.notifiedAt !== null,
      },
    });
    return outcome;
  } catch (err) {
    console.error('safety alert dispatch failed', flag.id, err);
    Sentry.captureException(err, { level: 'fatal', tags: { area: 'safety_alert', flag_id: flag.id, severity } });
    return null;
  }
}
