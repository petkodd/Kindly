-- ============================================================
-- Kindly — Migration 0006: server-side session revocation
-- Stateless session tokens can't be revoked by clearing a cookie. Add a
-- per-user watermark: any token issued (iat) before sessions_valid_from is
-- rejected. Bumped on password change and account deletion, so those actions
-- immediately invalidate every outstanding token for the user.
-- ============================================================

ALTER TABLE users ADD COLUMN sessions_valid_from TIMESTAMPTZ NOT NULL DEFAULT now();
