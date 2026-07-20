/**
 * Internal price mapping for Deepgram STT + ElevenLabs TTS usage costs.
 * Neither provider's API response includes a per-request dollar cost (see
 * src/lib/speech/providers.ts — Deepgram returns audio duration, ElevenLabs
 * returns only the synthesized audio), so cost is computed here from list
 * pricing captured at implementation time (2026-07) rather than read from
 * either provider directly. These rates must be reverified periodically
 * against actual provider invoices — they will drift if either provider
 * changes pricing.
 *
 * Deepgram Nova-2 STT: $0.0043/minute, billed per-second with no minimum
 * rounding (so raw audio duration IS the billed quantity for this
 * integration) — https://brasstranscripts.com/blog/deepgram-pricing-per-minute-2025-real-time-vs-batch
 * ElevenLabs Turbo v2.5 TTS: $0.05 per 1,000 characters —
 * https://elevenlabs.io/pricing/api
 *
 * Rates are kept at full precision (not pre-rounded) and expressed in micros
 * (millionths of a dollar) per unit; only the final cost_micros is rounded,
 * so quantity * unit_rate_micros reproduces cost_micros exactly for a given
 * rate — needed for the cost pipeline's fixture-exactness tests.
 */
export const DEEPGRAM_STT_MICROS_PER_SECOND = (0.0043 / 60) * 1_000_000;
export const ELEVENLABS_TTS_MICROS_PER_CHARACTER = (0.05 / 1_000) * 1_000_000;

export function deepgramCostMicros(durationSeconds: number): number {
  return Math.round(durationSeconds * DEEPGRAM_STT_MICROS_PER_SECOND);
}

export function elevenLabsCostMicros(characterCount: number): number {
  return Math.round(characterCount * ELEVENLABS_TTS_MICROS_PER_CHARACTER);
}

// LLM/Claude inference cost is deliberately out of scope for the admin cost
// metrics feature (feature/admin-analytics): src/lib/ai/anthropic.ts
// currently discards the Anthropic SDK's `usage` (input/output token) field
// entirely, and the AiClient interface (src/lib/ai/types.ts) has nowhere to
// carry it. Wiring that through — and its fake client used in tests — is a
// separate, larger change than this feature's STT+TTS cost pipeline.
// Deliberately not built as code yet, same posture as the referral-reward
// deferral above: implement alongside adding a 'claude_completion' entry to
// usage_provider_t (db/migrations/0012_usage_costs.sql) and a per-token rate
// pair here, once token accounting is actually wired into src/lib/ai/index.ts.
