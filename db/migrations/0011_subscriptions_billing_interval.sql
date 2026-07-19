-- Annual billing option: track which interval a subscription is on. Nullable
-- and never backfilled — existing rows predate this feature and stay NULL;
-- application code treats NULL as 'month' (today's only real behavior), so
-- no existing subscriber is migrated or reprompted by this column existing.
-- Split into two statements (not an inline ADD COLUMN ... CHECK) — pg-mem's
-- parser (used by the test suite) can't handle that combined form. The
-- explicit `IS NULL OR` also isn't just belt-and-suspenders for real
-- Postgres (which already allows NULL through a plain IN check via
-- three-valued logic) — pg-mem's CHECK evaluator does NOT implement that,
-- so without it every row omitting billing_interval fails validation there.
ALTER TABLE subscriptions ADD COLUMN billing_interval TEXT;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_billing_interval_check
  CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year'));
