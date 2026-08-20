-- ============================================================
-- Kindly — Migration 0013: Founding Family Beta invitations
--
-- One-time, email-bound, expiring invite tokens for the first 10 invited
-- families, granting a time-boxed entitlement with no Stripe involvement.
-- Mirrors magic_link_tokens (hash-only storage; the raw token is returned
-- once at issue time and never persisted or logged) and referrals' atomic
-- single-UPDATE redemption guard (WHERE status = 'pending' ...).
-- ============================================================

CREATE TYPE beta_invite_status_t AS ENUM ('pending', 'redeemed', 'expired', 'revoked');

CREATE TABLE beta_invites (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized     CITEXT NOT NULL,
  token_hash           TEXT NOT NULL UNIQUE,
  status               beta_invite_status_t NOT NULL DEFAULT 'pending',
  expires_at           TIMESTAMPTZ NOT NULL,
  redeemed_at          TIMESTAMPTZ,
  redeemed_by_user_id  UUID REFERENCES users(id),
  created_by_user_id   UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_beta_invites_email ON beta_invites(email_normalized);

-- The beta entitlement itself reuses the existing subscriptions table rather
-- than a parallel model: subscriptionRepo.isBillingCurrent is already the
-- single gate for talk/dashboard access (conversationRepo.openSession), so
-- adding one status value makes an unexpired beta grant "current" everywhere
-- that gate already runs, with no other call site changing. `current_period_end`
-- (existing column) doubles as beta_ends_at; `created_at` doubles as
-- beta_started_at; stripe_customer_id/stripe_sub_id/billing_interval simply
-- stay NULL for a beta row (the "billing_provider: null" requirement).
ALTER TYPE subscription_status ADD VALUE 'beta';

-- One subscription row per invite, enforced at the DB level: a parallel or
-- retried activation request can create at most one beta entitlement via
-- INSERT ... ON CONFLICT (beta_invite_id) DO NOTHING (see
-- subscriptionRepo.grantBeta). This is the last-line idempotency guarantee
-- even if the surrounding transaction is retried — the activation route
-- (src/app/api/billing/beta/activate/route.ts) additionally runs the invite
-- redemption + this grant + the audit write inside one withTransaction
-- (src/lib/db.ts) for all-or-nothing atomicity on real Postgres.
ALTER TABLE subscriptions ADD COLUMN beta_invite_id UUID REFERENCES beta_invites(id);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_beta_invite_id_unique UNIQUE (beta_invite_id);
