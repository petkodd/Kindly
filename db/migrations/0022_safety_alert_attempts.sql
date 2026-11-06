-- ============================================================
-- Kindly — Migration 0022: safety alert delivery attempts
--
-- Release check NEW-3 (chat 15): a P0/P1 family alert that was not delivered
-- is retried by the daily end-idle-sessions job (Vercel Hobby allows daily
-- crons only). alert_attempts counts every dispatch of a flag's alert, so the
-- retry stops after 3 attempts in total.
-- ============================================================

ALTER TABLE safety_flags ADD COLUMN alert_attempts INTEGER NOT NULL DEFAULT 0;
