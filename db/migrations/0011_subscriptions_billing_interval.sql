-- Annual billing option: track which interval a subscription is on. Nullable
-- and never backfilled — existing rows predate this feature and stay NULL;
-- application code treats NULL as 'month' (today's only real behavior), so
-- no existing subscriber is migrated or reprompted by this column existing.
-- A real ENUM (not TEXT+CHECK) to match every other small-fixed-set column
-- in this schema (plan_t, subscription_status, etc. — see 0001_init.sql).
CREATE TYPE billing_interval_t AS ENUM ('month', 'year');
ALTER TABLE subscriptions ADD COLUMN billing_interval billing_interval_t;
