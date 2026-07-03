-- ============================================================
-- Kindly — Migration 0005: auth rate limiting
-- Fixed-window counter, keyed by caller (e.g. login:ip:<addr>). DB-backed so it
-- holds across serverless instances (an in-memory limiter would not). Used to
-- throttle the login endpoint against password brute-force.
-- ============================================================

CREATE TABLE auth_rate_limit (
  key           TEXT PRIMARY KEY,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
  count         INT NOT NULL DEFAULT 0
);
