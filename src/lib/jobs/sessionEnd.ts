import type { Querier } from '../querier';
import type { AiClient, ConversationTurn, MoodSignal } from '../ai';
import { getAiClient } from '../ai';
import { sanitizeFamilySummary } from '../ai/prompts';
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
  extracted: boolean;
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

  const { rows } = await q.query<{
    parent_id: string;
    summary_text: string | null;
    mood_signal: string | null;
    memories_extracted_at: string | null;
  }>(
    `SELECT parent_id, summary_text, mood_signal, memories_extracted_at
     FROM conversations WHERE id = $1`,
    [conversationId],
  );
  const convo = rows[0];
  if (!convo) return { summarized: false, extracted: false, moodSignal: null, memoriesProposed: 0 };

  // The two sub-jobs are guarded independently, so a retry after a partial
  // failure finishes only the half that hasn't run yet.
  const needsSummary = convo.summary_text === null;
  const needsExtraction = convo.memories_extracted_at === null;
  if (!needsSummary && !needsExtraction) {
    return {
      summarized: false,
      extracted: false,
      moodSignal: convo.mood_signal as MoodSignal | null,
      memoriesProposed: 0,
    };
  }

  const parent = await parentRepo.getById(q, convo.parent_id);
  const turns: ConversationTurn[] = (await conversationRepo.listTurns(q, conversationId)).map(
    (t) => ({ role: t.role, content: t.content }),
  );

  let moodSignal: MoodSignal | null = convo.mood_signal as MoodSignal | null;

  // summarize_conversation
  if (needsSummary) {
    const summary = await ai.summarizeConversation({ firstName: parent.first_name, turns });
    // Code-level backstop: never surface restricted detail to family, even if
    // the model ignored the prompt.
    const safe = sanitizeFamilySummary(summary.summaryText, parent.first_name);
    if (safe.redacted) {
      console.warn(`session-end: redacted restricted content from summary of ${conversationId}`);
    }
    await conversationRepo.recordSummary(q, conversationId, safe.text, summary.moodSignal);
    moodSignal = summary.moodSignal;
  }

  // extract_memory_candidates — proposed memories await parent/buyer confirmation.
  let memoriesProposed = 0;
  if (needsExtraction) {
    const candidates = await ai.extractMemories({ turns });
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
    await conversationRepo.markMemoriesExtracted(q, conversationId);
  }

  return { summarized: needsSummary, extracted: needsExtraction, moodSignal, memoriesProposed };
}
