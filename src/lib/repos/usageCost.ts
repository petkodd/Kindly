import type { Querier } from '../querier';
import {
  DEEPGRAM_STT_MICROS_PER_SECOND,
  ELEVENLABS_TTS_MICROS_PER_CHARACTER,
  deepgramCostMicros,
  elevenLabsCostMicros,
  llmCostMicros,
} from '../billing/usageRates';
import type { AiUsage } from '../ai/types';

export type UsageProvider = 'deepgram_stt' | 'elevenlabs_tts' | 'anthropic_llm';
export type UsageUnit = 'second' | 'character' | 'token';
/** Which model call an LLM row paid for. */
export type LlmOperation = 'reply' | 'regeneration' | 'scan' | 'extraction' | 'summary';

export interface UsageCostRecord {
  id: string;
  /** Null once the turn is purged (30-day transcript retention), or for session-level LLM calls. */
  turn_id: string | null;
  conversation_id: string;
  parent_id: string;
  provider: UsageProvider;
  unit: UsageUnit;
  quantity: string;         // NUMERIC comes back from pg as a string
  unit_rate_micros: string; // NUMERIC comes back from pg as a string
  cost_micros: string;      // BIGINT comes back from pg as a string
  input_tokens: number | null;
  output_tokens: number | null;
  model: string | null;
  operation: string | null;
  created_at: string;
}

interface RecordArgs {
  turnId: string | null;
  conversationId: string;
  parentId: string;
}

async function insert(
  q: Querier,
  args: RecordArgs & {
    provider: UsageProvider;
    unit: UsageUnit;
    quantity: number;
    unitRateMicros: number;
    costMicros: number;
    inputTokens?: number | null;
    outputTokens?: number | null;
    model?: string | null;
    operation?: string | null;
  },
): Promise<UsageCostRecord> {
  const { rows } = await q.query<UsageCostRecord>(
    `INSERT INTO usage_costs
       (turn_id, conversation_id, parent_id, provider, unit, quantity, unit_rate_micros, cost_micros,
        input_tokens, output_tokens, model, operation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      args.turnId,
      args.conversationId,
      args.parentId,
      args.provider,
      args.unit,
      args.quantity,
      args.unitRateMicros,
      args.costMicros,
      args.inputTokens ?? null,
      args.outputTokens ?? null,
      args.model ?? null,
      args.operation ?? null,
    ],
  );
  return rows[0];
}

/**
 * Real-time cost ledger for Deepgram STT + ElevenLabs TTS usage — see
 * src/lib/billing/usageRates.ts for the rate constants and the "internal
 * price mapping, not read from the provider" rationale. Both methods take
 * only the raw usage quantity; the pricing formula lives exclusively in
 * usageRates.ts so it's never duplicated at a call site.
 */
export const usageCostRepo = {
  /** Record the Deepgram STT cost for the 'parent' turn it transcribed. */
  async recordSttCost(
    q: Querier,
    args: RecordArgs & { durationSeconds: number },
  ): Promise<UsageCostRecord> {
    return insert(q, {
      ...args,
      provider: 'deepgram_stt',
      unit: 'second',
      quantity: args.durationSeconds,
      unitRateMicros: DEEPGRAM_STT_MICROS_PER_SECOND,
      costMicros: deepgramCostMicros(args.durationSeconds),
    });
  },

  /**
   * Record one Anthropic call's token cost. quantity is total tokens and
   * unit_rate_micros the blended rate, so quantity * rate still reproduces
   * cost_micros; the input/output split and model are stored for audit.
   */
  async recordLlmCost(
    q: Querier,
    args: RecordArgs & { usage: AiUsage; operation: LlmOperation },
  ): Promise<UsageCostRecord> {
    const { model, inputTokens, outputTokens } = args.usage;
    const total = inputTokens + outputTokens;
    const cost = llmCostMicros(model, inputTokens, outputTokens);
    return insert(q, {
      ...args,
      provider: 'anthropic_llm',
      unit: 'token',
      quantity: total,
      unitRateMicros: total === 0 ? 0 : cost / total,
      costMicros: cost,
      inputTokens,
      outputTokens,
      model,
      operation: args.operation,
    });
  },

  /**
   * Record every model call of a turn, best-effort: cost accounting must never
   * fail the parent's conversation. Calls without usage (the fake client) are skipped.
   */
  async recordLlmUsages(
    q: Querier,
    args: RecordArgs & { usages: { usage?: AiUsage; operation: LlmOperation }[] },
  ): Promise<void> {
    try {
      for (const u of args.usages) {
        if (!u.usage) continue;
        await usageCostRepo.recordLlmCost(q, { ...args, usage: u.usage, operation: u.operation });
      }
    } catch (err) {
      console.error('llm usage cost write failed', args.conversationId, err);
    }
  },

  /** Record the ElevenLabs TTS cost for the 'kindly' turn it synthesized. */
  async recordTtsCost(
    q: Querier,
    args: RecordArgs & { characterCount: number },
  ): Promise<UsageCostRecord> {
    return insert(q, {
      ...args,
      provider: 'elevenlabs_tts',
      unit: 'character',
      quantity: args.characterCount,
      unitRateMicros: ELEVENLABS_TTS_MICROS_PER_CHARACTER,
      costMicros: elevenLabsCostMicros(args.characterCount),
    });
  },
};
