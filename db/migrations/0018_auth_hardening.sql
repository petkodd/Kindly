-- ============================================================
-- Kindly — Migration 0018: auth hardening (chat 7)
-- ============================================================

-- Email verification. Existing accounts are treated as verified (they signed
-- up before verification existed and many have already received email from
-- us); every new signup must click its emailed link.
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- One-time email links now have a purpose: 'login' (magic sign-in, which also
-- verifies the address), or 'reset' (set a new password). A reset link can
-- never be used to sign in directly, and vice versa.
ALTER TABLE magic_link_tokens ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login';
ALTER TABLE magic_link_tokens
  ADD CONSTRAINT magic_link_tokens_purpose_check CHECK (purpose IN ('login', 'reset'));
