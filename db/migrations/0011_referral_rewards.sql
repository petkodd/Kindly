-- Referral reward redemption: on a successful referral redemption, credit
-- both the referrer and the referred buyer one free month via a Stripe
-- customer balance credit (see src/lib/billing/referralReward.ts). One row
-- per referral (referral_id UNIQUE is the idempotency anchor — retries and
-- webhook/route replays can't double-apply). Referrer/referred sides are
-- tracked and retried independently since the two Stripe calls can fail
-- independently (e.g. the referrer has a Stripe customer, the referred buyer
-- — who just signed up — usually doesn't yet).
CREATE TABLE referral_rewards (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id                UUID NOT NULL UNIQUE REFERENCES referrals(id) ON DELETE CASCADE,
  -- Nullable, no ON DELETE: mirrors referrals.redeemed_by / audit_log.actor_id
  -- — the purge job anonymizes these (src/lib/jobs/purge.ts
  -- USER_REF_NULLIFICATIONS) rather than blocking a user's hard-delete.
  referrer_user_id           UUID REFERENCES users(id),
  referred_user_id           UUID REFERENCES users(id),
  reward_type                TEXT NOT NULL DEFAULT 'stripe_balance_credit',
  amount_cents               INTEGER NOT NULL,
  currency                   TEXT NOT NULL,
  referrer_status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (referrer_status IN ('pending','processing','applied','failed','reversed')),
  referred_status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (referred_status IN ('pending','processing','applied','failed','reversed')),
  referrer_stripe_object_id  TEXT,   -- Stripe balance transaction id
  referred_stripe_object_id  TEXT,
  referrer_failure_reason    TEXT,
  referred_failure_reason    TEXT,
  -- Overall status, recomputed from the two sides above on every write —
  -- lets Support read current reward state without querying Stripe.
  status                     TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','partial','applied','failed','reversed')),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_referral_rewards_status ON referral_rewards(status, updated_at DESC);
