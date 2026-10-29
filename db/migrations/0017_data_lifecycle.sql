-- ============================================================
-- Kindly — Migration 0017: data lifecycle & billing integrity (chat 6)
-- ============================================================

-- 1. Purge crash: beta_invites referenced users with no ON DELETE rule, so
--    deleting a user who redeemed or created an invite hit a foreign-key
--    error and the whole purge run failed. Keep the invite row, drop the link.
--    (Each constraint is dropped under both Postgres' and pg-mem's default
--    name; the one that doesn't exist is skipped.)
ALTER TABLE beta_invites DROP CONSTRAINT IF EXISTS beta_invites_redeemed_by_user_id_fkey;
ALTER TABLE beta_invites DROP CONSTRAINT IF EXISTS beta_invites_redeemed_by_user_id_fk;
ALTER TABLE beta_invites
  ADD CONSTRAINT beta_invites_redeemed_by_user_id_fkey
  FOREIGN KEY (redeemed_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE beta_invites DROP CONSTRAINT IF EXISTS beta_invites_created_by_user_id_fkey;
ALTER TABLE beta_invites DROP CONSTRAINT IF EXISTS beta_invites_created_by_user_id_fk;
ALTER TABLE beta_invites
  ADD CONSTRAINT beta_invites_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- 2. Stripe webhook idempotency: every processed event id is recorded, so a
--    redelivered event is acknowledged without being applied twice.
CREATE TABLE stripe_events (
  id           TEXT PRIMARY KEY,           -- Stripe event id (evt_…)
  type         TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Out-of-order protection: the Stripe `created` time of the event that
--    last wrote this subscription row. An older event never overwrites it.
ALTER TABLE subscriptions ADD COLUMN stripe_event_at TIMESTAMPTZ;

-- 4. Decision D5: the buyer opts in to automatic weekly summary sending.
ALTER TABLE users ADD COLUMN auto_send_summaries BOOLEAN NOT NULL DEFAULT false;
