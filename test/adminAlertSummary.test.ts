import { describe, it, expect } from 'vitest';
import { alertSummary } from '../src/app/admin/AdminDashboard';

const flag = (over: Record<string, unknown>) => ({
  id: 'f1',
  parent_id: 'p1',
  conversation_id: null,
  severity: 'p0_crisis' as const,
  status: 'open' as const,
  detail: null,
  created_at: '2026-10-20T10:00:00Z',
  ...over,
});

describe('admin flags UI: alert delivery summary', () => {
  it('shows per-channel status and when the family was notified', () => {
    expect(
      alertSummary(flag({ alert_email_status: 'sent', alert_sms_status: 'skipped_no_phone', notified_at: '2026-10-20T10:01:00Z' })),
    ).toBe('Alert: family email sent, family SMS no phone · notified 10/20/2026, 10:01:00 AM UTC');
  });

  it('makes a failed or throttled alert visible', () => {
    expect(alertSummary(flag({ alert_email_status: 'failed', alert_admin_status: 'sent', notified_at: null }))).toBe(
      'Alert: family email FAILED, admin email sent · family not notified',
    );
    expect(alertSummary(flag({ alert_email_status: 'suppressed_rate_limit', alert_sms_status: 'suppressed_rate_limit' }))).toMatch(
      /already alerted <30 min/,
    );
  });

  it('shows nothing for a flag with no alert (P2)', () => {
    expect(alertSummary(flag({}))).toBeNull();
  });
});
