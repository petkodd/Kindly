-- ============================================================
-- 0021: Facility demo requests — chat 13.
--
-- The senior-living page's demo form (facility name, residents, role, name,
-- email, optional phone) posts to /api/demo, which stores the request here and
-- emails it to SALES_ALERT_EMAIL. Kept separate from waitlist_signups, which
-- is a consumer list holding nothing but an email.
--
-- Retention: rows older than 365 days are deleted by the daily purge job
-- (src/lib/jobs/purge.ts), on the same marketing clock as waitlist signups.
-- No FK to users: a facility contact usually has no account.
-- ============================================================

CREATE TABLE facility_demo_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_name   TEXT NOT NULL,        -- 1–200 chars, enforced in src/lib/demoRequest.ts
  residents       INTEGER NOT NULL CHECK (residents BETWEEN 1 AND 5000),
  contact_role    TEXT NOT NULL CHECK (contact_role IN (
                    'executive_director', 'administrator', 'life_enrichment',
                    'nursing', 'sales_marketing', 'owner_operator', 'other')),
  contact_name    TEXT NOT NULL,        -- 1–120 chars, enforced in src/lib/demoRequest.ts
  email           CITEXT NOT NULL,
  phone           TEXT,                 -- E.164 (+1…) when given
  source_page     TEXT,
  -- What happened to the sales email: 'sent' (real provider), 'simulated'
  -- (fake client), 'not_configured' (SALES_ALERT_EMAIL unset), 'failed'.
  sales_alert     TEXT NOT NULL DEFAULT 'pending'
                    CHECK (sales_alert IN ('pending', 'sent', 'simulated', 'not_configured', 'failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_facility_demo_requests_created ON facility_demo_requests(created_at DESC);
