-- ============================================================
-- 0020: Referral credit ("give a month, get a month") — chat 11.
--
-- Idea taken from Petko's local commit a71b3fd (Stripe customer-balance
-- credit, per-side state, idempotent claim), reimplemented on top of
-- release/mvp-alpha with one change of trigger: the credit is applied only
-- after the redeemer's first PAID invoice (invoice.paid webhook), not at
-- redemption time.
--
-- referral_rewards: one row per redeemed referral (referral_id UNIQUE is the
-- idempotency anchor). The two sides (referrer / referred) are tracked
-- independently because their Stripe calls can fail independently.
-- ============================================================

-- A user can redeem at most one referral code, ever.
CREATE UNIQUE INDEX referrals_one_redemption_per_user
  ON referrals (redeemed_by) WHERE redeemed_by IS NOT NULL;

CREATE TABLE referral_rewards (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id               UUID NOT NULL UNIQUE REFERENCES referrals(id) ON DELETE CASCADE,
  -- Nullable, no ON DELETE: the purge job anonymizes these (see
  -- USER_REF_NULLIFICATIONS in src/lib/jobs/purge.ts), like referrals.redeemed_by.
  referrer_user_id          UUID REFERENCES users(id),
  referred_user_id          UUID REFERENCES users(id),
  currency                  TEXT NOT NULL DEFAULT 'usd',
  referrer_amount_cents     INTEGER,
  referred_amount_cents     INTEGER,
  referrer_status           TEXT NOT NULL DEFAULT 'pending'
    CHECK (referrer_status IN ('pending', 'processing', 'applied', 'failed')),
  referred_status           TEXT NOT NULL DEFAULT 'pending'
    CHECK (referred_status IN ('pending', 'processing', 'applied', 'failed')),
  referrer_stripe_txn_id    TEXT,   -- Stripe customer balance transaction id
  referred_stripe_txn_id    TEXT,
  referrer_failure_reason   TEXT,
  referred_failure_reason   TEXT,
  referrer_claimed_at       TIMESTAMPTZ,
  referred_claimed_at       TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_referral_rewards_referrer ON referral_rewards (referrer_user_id);
