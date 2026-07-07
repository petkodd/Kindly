-- ============================================================
-- Kindly — Migration 0002: idempotent summary deliveries
-- Owner: Backend Dev · Reviewers: Privacy Advisor
-- A summary must be delivered at most once per recipient consent. Without
-- this, two concurrent POST /api/parents/:id/summary/send requests can both
-- insert a delivery row for the same (summary, recipient) and the family
-- receives the weekly summary twice. summaryRepo.send pairs this with
-- INSERT ... ON CONFLICT DO NOTHING so re-sends are no-ops at the DB layer.
-- ============================================================

CREATE UNIQUE INDEX uq_summary_delivery_consent
  ON summary_deliveries (summary_id, consent_id);
