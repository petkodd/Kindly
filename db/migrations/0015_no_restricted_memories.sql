-- ============================================================
-- Kindly — Migration 0015: restricted details are never memories (decision D6)
--
-- Health, mood and risk details picked up in conversation were stored as
-- 'restricted' memories, and the buyer's Memories page listed them. Under D6
-- they are never stored as reviewable memories: safety concerns are caught
-- per turn by the safety scan and live only as safety flags.
--
-- 1. Remove existing restricted rows. They were never shown to the companion
--    or in family summaries, so nothing the product relies on is lost.
--    IRREVERSIBLE: this deletes data on purpose (data minimisation). Review
--    before applying to production.
-- 2. Enforce it in the schema, so no code path can store one again.
-- ============================================================

DELETE FROM memories WHERE sensitivity = 'restricted';

ALTER TABLE memories
  ADD CONSTRAINT memories_never_restricted CHECK (sensitivity <> 'restricted');
