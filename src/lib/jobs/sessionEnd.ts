import type { Querier } from '../querier';
import type { AiClient, ConversationTurn, MoodSignal } from '../ai';
import { getAiClient } from '../ai';
import { conversationRepo } from '../repos/conversation';
import { memoryRepo } from '../repos/memory';
import { parentRepo } from '../repos/parent';

/**
 * Session-end jobs from api_plan_v1.md, run when a conversation ends:
 *  - summarize_conversation → writes conversations.summary_text + mood_signal
 *  - extract_memory_candidates → inserts `proposed` memories from the transcript
 *
 * This is the seam that makes the weekly summary real: until a conversation has
 * a summary_text / mood_signal, the weekly cron counts it but shows no highlight.
 *
 * Idempotent: a conversation that already has a summary is skipped, so a
 * re-trigger never double-writes or re-proposes memories. Confidence-gated:
 * low-confidence candidates are discarded (per the extraction prompt spec).
 */

export interface SessionEndResult {
  summarized: boolean;
  moodSignal: MoodSignal | null;
  memoriesProposed: number;
}

export interface SessionEndOptions {
  ai?: AiClient;
  /** Candidates below this confidence are discarded. */
  minConfidence?: number;
}

export async function runSessionEndJobs(
  q: Querier,
  conversationId: string,
  opts: SessionEndOptions = {},
): Promise<SessionEndResult> {
  const ai = opts.ai ?? getAiClient();
  const minConfidence = opts.minConfidence ?? 0.5;

  const { rows } = await q.query<{ parent_id: string; summary_text: string | null }>(
    `SELECT parent_id, summary_text FROM conversations WHERE id = $1`,
    [conversationId],
  );
  const convo = rows[0];
  // Unknown conversation, or already processed → no-op (idempotent).
  if (!convo || convo.summary_text !== null) {
    return { summarized: false, moodSignal: null, memoriesProposed: 0 };
  }

  const parent = await parentRepo.getById(q, convo.parent_id);
  const turns: ConversationTurn[] = (await conversationRepo.listTurns(q, conversationId)).map(
    (t) => ({ role: t.role, content: t.content }),
  );

  // summarize_conversation
  const summary = await ai.summarizeConversation({ firstName: parent.first_name, turns });
  await conversationRepo.recordSummary(q, conversationId, summary.summaryText, summary.moodSignal);

  // extract_memory_candidates — proposed memories await parent/buyer confirmation.
  const candidates = await ai.extractMemories({ turns });
  let memoriesProposed = 0;
  for (const c of candidates) {
    if (c.confidence < minConfidence) continue;
    await memoryRepo.add(q, {
      parentId: convo.parent_id,
      layer: c.layer,
      key: c.key,
      value: c.value,
      source: 'conversation',
      sensitivity: c.sensitivity,
    });
    memoriesProposed += 1;
  }

  return { summarized: true, moodSignal: summary.moodSignal, memoriesProposed };
}
