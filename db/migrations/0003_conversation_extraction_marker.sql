-- ============================================================
-- Kindly — Migration 0003: independent session-end job markers
-- summarize_conversation and extract_memory_candidates must be independently
-- idempotent. summary_text already marks "summarized"; add a separate marker so
-- that if extraction fails after a successful summarize, a re-trigger can still
-- finish extraction without re-writing the summary (and without a shared marker
-- that would silently drop the extracted memories).
-- ============================================================

ALTER TABLE conversations ADD COLUMN memories_extracted_at TIMESTAMPTZ;
