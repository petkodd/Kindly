-- ============================================================
-- Kindly — Migration 0016: LLM cost in the usage ledger (chat 5)
--
-- 1. usage_costs records Anthropic model calls as well as speech: provider
--    'anthropic_llm', unit 'token', with input_tokens / output_tokens, the
--    model id and the operation (reply, scan, regeneration, extraction,
--    summary). provider/unit move from enums to TEXT + CHECK, so a new
--    provider is one CHECK change (and pg-mem can apply it in tests).
-- 2. Cost history must outlive the 30-day transcript purge, which deletes
--    conversation_turns rows. turn_id becomes nullable with ON DELETE SET
--    NULL (it used to CASCADE, so purged turns took their costs with them).
--    LLM calls not tied to one turn (session-end summary/extraction) have no
--    turn_id at all.
-- ============================================================

ALTER TABLE usage_costs ALTER COLUMN provider TYPE TEXT;
ALTER TABLE usage_costs ALTER COLUMN unit TYPE TEXT;
DROP TYPE usage_provider_t;
DROP TYPE usage_unit_t;
ALTER TABLE usage_costs
  ADD CONSTRAINT usage_costs_provider_check CHECK (provider IN ('deepgram_stt', 'elevenlabs_tts', 'anthropic_llm'));
ALTER TABLE usage_costs
  ADD CONSTRAINT usage_costs_unit_check CHECK (unit IN ('second', 'character', 'token'));

-- quantity holds total tokens for LLM rows; the split is kept for pricing.
ALTER TABLE usage_costs ADD COLUMN input_tokens INT;
ALTER TABLE usage_costs ADD COLUMN output_tokens INT;
ALTER TABLE usage_costs ADD COLUMN model TEXT;
ALTER TABLE usage_costs ADD COLUMN operation TEXT;

ALTER TABLE usage_costs ALTER COLUMN turn_id DROP NOT NULL;
ALTER TABLE usage_costs DROP CONSTRAINT IF EXISTS usage_costs_turn_id_fkey;
-- Same foreign key under pg-mem's naming (used by the test suite); a no-op in Postgres.
ALTER TABLE usage_costs DROP CONSTRAINT IF EXISTS usage_costs_turn_id_fk;
ALTER TABLE usage_costs
  ADD CONSTRAINT usage_costs_turn_id_fkey
  FOREIGN KEY (turn_id) REFERENCES conversation_turns(id) ON DELETE SET NULL;
