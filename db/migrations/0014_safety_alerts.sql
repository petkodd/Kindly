-- ============================================================
-- Kindly — Migration 0014: safety alerts (decision D2)
--
-- P0/P1 safety flags alert the gift buyer by email and, when they have given
-- an alert phone with SMS consent, by SMS. P3 goes to the internal admin only.
-- ============================================================

-- Buyer's "Emergency alert phone" (E.164) and when they opted in to SMS
-- alerts (US TCPA). Collected in onboarding (chat 10); SMS is sent only when
-- both are set.
ALTER TABLE users ADD COLUMN alert_phone TEXT;
ALTER TABLE users ADD COLUMN sms_alert_consent_at TIMESTAMPTZ;

-- Delivery record per flag, shown in the admin flags queue. Status values:
-- 'sent' | 'failed' | 'skipped_no_phone' | 'skipped_no_consent' |
-- 'suppressed_rate_limit' | 'not_configured'. NULL = channel not used.
ALTER TABLE safety_flags ADD COLUMN notified_at TIMESTAMPTZ;
ALTER TABLE safety_flags ADD COLUMN alert_email_status TEXT;
ALTER TABLE safety_flags ADD COLUMN alert_sms_status TEXT;
ALTER TABLE safety_flags ADD COLUMN alert_admin_status TEXT;

-- At most one family alert per parent per 30 minutes. One row per parent,
-- claimed atomically (see safetyFlagRepo.claimAlertSlot) so two
-- concurrent flagged turns can't both alert.
CREATE TABLE safety_alert_throttle (
  parent_id     UUID PRIMARY KEY REFERENCES parents(id) ON DELETE CASCADE,
  last_alert_at TIMESTAMPTZ NOT NULL
);
