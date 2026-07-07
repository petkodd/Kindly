-- Deduplicate waitlist signups by email.
-- ON CONFLICT DO NOTHING in the route handler requires this constraint.
ALTER TABLE waitlist_signups ADD CONSTRAINT waitlist_signups_email_unique UNIQUE (email);
