-- ============================================================
-- Kindly — Migration 0008: passwordless "magic link" sign-in
-- Mirrors parent_access_tokens: only a hash is stored, the raw token is
-- returned once at issue time. Single-use (used_at) and short-lived
-- (expires_at NOT NULL, unlike the long-lived parent link).
-- ============================================================

CREATE TABLE magic_link_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX idx_magic_link_user ON magic_link_tokens(user_id);
