import type { Querier } from '../querier';
import {
  DEEPGRAM_STT_MICROS_PER_SECOND,
  ELEVENLABS_TTS_MICROS_PER_CHARACTER,
  deepgramCostMicros,
  elevenLabsCostMicros,
} from '../billing/usageRates';

export interface UsageCostRecord {
  id: string;
  turn_id: string;
  conversation_id: string;
  parent_id: string;
  provider: 'deepgram_stt' | 'elevenlabs_tts';
  unit: 'second' | 'character';
  quantity: string;         // NUMERIC comes back from pg as a string
  unit_rate_micros: string; // NUMERIC comes back from pg as a string
  cost_micros: string;      // BIGINT comes back from pg as a string
  created_at: string;
}

interface RecordArgs {
  turnId: string;
  conversationId: string;
  parentId: string;
}

async function insert(
  q: Querier,
  args: RecordArgs & {
    provider: 'deepgram_stt' | 'elevenlabs_tts';
    unit: 'second' | 'character';
    quantity: number;
    unitRateMicros: number;
    costMicros: number;
  },
): Promise<UsageCostRecord> {
  const { rows } = await q.query<UsageCostRecord>(
    `INSERT INTO usage_costs
       (turn_id, conversation_id, parent_id, provider, unit, quantity, unit_rate_micros, cost_micros)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
