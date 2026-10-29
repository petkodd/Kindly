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
 * ElevenLabs Multilingual v2 TTS: $0.10 per 1,000 characters (double the
 * Turbo v2.5 rate — providers.ts switched models 2026-07 for voice quality;
 * this rate must move with it) — https://elevenlabs.io/pricing/api
 *
 * Rates are kept at full precision (not pre-rounded) and expressed in micros
 * (millionths of a dollar) per unit; only the final cost_micros is rounded,
 * so quantity * unit_rate_micros reproduces cost_micros exactly for a given
 * rate — needed for the cost pipeline's fixture-exactness tests.
 */
export const DEEPGRAM_STT_MICROS_PER_SECOND = (0.0043 / 60) * 1_000_000;
export const ELEVENLABS_TTS_MICROS_PER_CHARACTER = (0.10 / 1_000) * 1_000_000;

export function deepgramCostMicros(durationSeconds: number): number {
  return Math.round(durationSeconds * DEEPGRAM_STT_MICROS_PER_SECOND);
}

export function elevenLabsCostMicros(characterCount: number): number {
  return Math.round(characterCount * ELEVENLABS_TTS_MICROS_PER_CHARACTER);
}

/**
 * Anthropic model prices in micros ($-millionths) per token. A price of
 * $3 per million tokens is exactly 3 micros per token. Source: Claude API
 * pricing, https://platform.claude.com/docs/en/about-claude/pricing (checked
 * 2026-10-29). Like the speech rates, these must be re-checked against
 * invoices; they drift when Anthropic changes prices or we change models.
 */
export const LLM_MICROS_PER_TOKEN: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-5-5': { input: 4, output: 20 },
  // Haiku 5.5's price for prompts up to 100k tokens; talk prompts are far smaller.
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

/**
 * A model missing from the table (e.g. a new AI_MODEL override) is priced at
 * the current Opus rate, so its cost is never under-reported; the row keeps
 * the model id so the gap is visible in admin.
 */
export const LLM_FALLBACK_MICROS_PER_TOKEN = { input: 5, output: 25 };

export function llmRates(model: string): { input: number; output: number; known: boolean } {
  // Dated snapshot ids ('claude-haiku-4-5-20251001') price like their alias.
  const alias = Object.keys(LLM_MICROS_PER_TOKEN).find((k) => model === k || model.startsWith(`${k}-2`));
  return alias ? { ...LLM_MICROS_PER_TOKEN[alias], known: true } : { ...LLM_FALLBACK_MICROS_PER_TOKEN, known: false };
}

export function llmCostMicros(model: string, inputTokens: number, outputTokens: number): number {
  const r = llmRates(model);
  return Math.round(inputTokens * r.input + outputTokens * r.output);
}
