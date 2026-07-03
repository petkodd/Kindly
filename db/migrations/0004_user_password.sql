-- ============================================================
-- Kindly — Migration 0004: buyer password auth
-- Adds a password hash for email+password buyers. Passwordless (magic) buyers
-- leave it null. The hash is scrypt(salt, password) — never a plaintext password.
-- ============================================================

ALTER TABLE users ADD COLUMN password_hash TEXT;
