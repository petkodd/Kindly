-- Per-provider-call cost ledger for the admin cost/retention metrics feature,
-- written in real time from src/app/api/talk/voice/route.ts (one row per
-- priced API call, not a post-hoc reconciliation). FK'd to the
-- conversation_turns row each cost belongs to, so a turn's cost is auditable
-- and reproducible: quantity + unit_rate_micros are stored alongside the
-- computed cost_micros rather than only a bare total, and cost_micros is
-- never recomputed from a possibly-since-changed rate. conversation_id and
-- parent_id are denormalized here (derivable via turn_id) so the aggregation
-- queries in src/lib/repos/adminMetrics.ts don't need a 3-way join per row —
-- same denormalization already used by safety_flags (parent_id alongside
-- conversation_id) above.
CREATE TYPE usage_provider_t AS ENUM ('deepgram_stt', 'elevenlabs_tts');
CREATE TYPE usage_unit_t     AS ENUM ('second', 'character');

CREATE TABLE usage_costs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id          UUID NOT NULL REFERENCES conversation_turns(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_id        UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  provider         usage_provider_t NOT NULL,
  unit             usage_unit_t NOT NULL,
  quantity         NUMERIC(12,4) NOT NULL,   -- seconds (STT) or characters (TTS)
  unit_rate_micros NUMERIC(12,4) NOT NULL,   -- full-precision $-millionths per unit, see src/lib/billing/usageRates.ts
  cost_micros      BIGINT NOT NULL,          -- round(quantity * unit_rate_micros), stored not recomputed
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_costs_conv           ON usage_costs(conversation_id);
CREATE INDEX idx_usage_costs_parent_created ON usage_costs(parent_id, created_at);
CREATE INDEX idx_usage_costs_created        ON usage_costs(created_at);
