-- Uniqueness for the Stripe subscription webhook upsert.
-- ON CONFLICT (stripe_sub_id) DO UPDATE in subscriptionRepo.upsertFromStripeSubscription
-- requires this constraint — without it, concurrent webhook deliveries for the
-- same Stripe subscription could each miss the other's row and insert twice.
-- NULL stays allowed (Postgres treats NULLs as distinct for uniqueness), so
-- rows without a Stripe subscription yet are unaffected.
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_stripe_sub_id_unique UNIQUE (stripe_sub_id);
