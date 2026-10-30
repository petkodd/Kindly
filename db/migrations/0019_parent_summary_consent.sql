-- ============================================================
-- Kindly — Migration 0019: parent consent to summary sharing (chat 9)
--
-- 1. consents.kind moves from the consent_kind_t enum to TEXT + CHECK (same
--    pattern as 0016), so a new kind is one CHECK change and pg-mem (tests)
--    can apply it — pg-mem has no ALTER TYPE … ADD VALUE.
-- 2. New kind 'parent_summary_sharing': the parent's own answer to the
--    talk-screen notice ("Each week, … get a short note …"). The exact notice
--    text and its version are stored in consents.detail. A "Not now" answer is
--    stored as a row that is revoked at once (detail.answer = 'not_now'), so
--    consentRepo.has() stays false while the answer is still on record.
--    Summary sending (manual and automatic) requires an active row.
-- ============================================================

ALTER TABLE consents ALTER COLUMN kind TYPE TEXT;
DROP TYPE consent_kind_t;
ALTER TABLE consents
  ADD CONSTRAINT consents_kind_check
  CHECK (kind IN ('buyer_attestation', 'parent_conversation', 'summary_recipient', 'parent_summary_sharing'));
