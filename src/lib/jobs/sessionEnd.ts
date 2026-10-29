import * as Sentry from '@sentry/nextjs';
import type { Querier } from '../querier';
import type { AiClient, ConversationTurn, MoodSignal } from '../ai';
import { getAiClient } from '../ai';
import { sanitizeFamilySummary } from '../ai/prompts';
import { conversationRepo } from '../repos/conversation';
import { containsSecretDetail, memoryRepo } from '../repos/memory';
import { parentRepo } from '../repos/parent';
import { auditRepo } from '../repos/audit';
import { usageCostRepo } from '../repos/usageCost';
import { EPISODIC_DECAY_DAYS, ValidationError } from '../types';

/**
 * Session-end jobs from api_plan_v1.md, run when a conversation ends:
 *  - summarize_conversation → writes conversations.summary_text + mood_signal
 *  - extract_memory_candidates → inserts `proposed` memories from the transcript
 *  - stamps retention_purge_at on the conversation's turns, making the
 *    purge_hard_deletes job's transcript-expiry step (src/lib/jobs/purge.ts)
 *    live: DEFAULT_TRANSCRIPT_RETENTION_DAYS from now, mirroring the account
 *    deletion promise.
 *
 * This is the seam that makes the weekly summary real: until a conversation has
 * a summary_text / mood_signal, the weekly cron counts it but shows no highlight.
 *
 * Idempotent: a conversation that already has a summary is skipped, so a
 * re-trigger never double-writes or re-proposes memories. Confidence-gated:
 * low-confidence candidates are discarded (per the extraction prompt spec).
 */

export const DEFAULT_TRANSCRIPT_RETENTION_DAYS = 30;

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
  /** Days until stamped turns become eligible for purge. */
  retentionDays?: number;
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

  // Stamp retention on the turns regardless of summary/extraction state below —
  // the SQL guard (retention_purge_at IS NULL) makes this safe to run on every
  // call, including retries after summarize/extract already completed.
  await conversationRepo.stampTurnRetention(
    q,
    conversationId,
    opts.retentionDays ?? DEFAULT_TRANSCRIPT_RETENTION_DAYS,
  );

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
    await usageCostRepo.recordLlmUsages(q, {
      turnId: null,
      conversationId,
      parentId: convo.parent_id,
      usages: [{ usage: summary.usage, operation: 'summary' }],
    });
    // Code-level backstop: never surface restricted detail to family, even if
    // the model ignored the prompt. A redaction firing means
    // CONVERSATION_SUMMARY_SYSTEM_V1 was NOT followed in production — that's
    // a prompt-adherence regression worth a human noticing, not just a line
    // in a server log nobody tails (console.error alone is silent in
    // practice — the same reasoning that put Sentry alerting on weekly-summary
    // delivery failures applies here). Never log the summary text itself,
    // only the (non-PII) conversation/parent ids.
    const safe = sanitizeFamilySummary(summary.summaryText, parent.first_name);
    if (safe.redacted) {
      console.warn(`session-end: redacted restricted content from summary of ${conversationId}`);
      Sentry.captureMessage('session-end: redacted restricted content from family summary', {
        level: 'warning',
        tags: { conversation_id: conversationId, parent_id: convo.parent_id, area: 'summary_redaction' },
      });
      await auditRepo.log(q, {
        actorId: null,
        action: 'summary_redacted',
        targetType: 'conversation',
        targetId: conversationId,
      });
    }
    await conversationRepo.recordSummary(q, conversationId, safe.text, summary.moodSignal);
    moodSignal = summary.moodSignal;
  }

  // extract_memory_candidates — proposed memories await parent/buyer confirmation.
  let memoriesProposed = 0;
  if (needsExtraction) {
    const { candidates, usage: extractionUsage } = await ai.extractMemories({ turns });
    await usageCostRepo.recordLlmUsages(q, {
      turnId: null,
      conversationId,
      parentId: convo.parent_id,
      usages: [{ usage: extractionUsage, operation: 'extraction' }],
    });
    const decayAt = new Date(Date.now() + EPISODIC_DECAY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    let dropped = 0;
    for (const c of candidates) {
      if (c.confidence < minConfidence) continue;
      // Decision D6: restricted candidates (health, mood, risk) are dropped,
      // never stored as reviewable memories. Safety concerns are already
      // caught per turn by the safety scan (src/lib/ai/turn.ts), which is the
      // only place such signals live.
      if (c.sensitivity === 'restricted') {
        dropped += 1;
        continue;
      }
      // Never propose a PIN, password or account number for family review,
      // even if the model ignored MEMORY_EXTRACTION_SYSTEM_V2.
      if (containsSecretDetail(`${c.key} ${c.value}`)) {
        dropped += 1;
        continue;
      }
      try {
        await memoryRepo.add(q, {
          parentId: convo.parent_id,
          layer: c.layer,
          key: c.key,
          value: c.value,
          source: 'conversation',
          sensitivity: c.sensitivity,
          // Episodic memories are time-bound by definition; they fade.
          decayAt: c.layer === 'episodic' ? decayAt : null,
        });
        memoriesProposed += 1;
      } catch (err) {
        // A malformed or over-long candidate must not stop the others. Never
        // log the candidate text (it is personal data).
        if (!(err instanceof ValidationError)) throw err;
        dropped += 1;
      }
    }
    if (dropped > 0) console.info(`session-end: dropped ${dropped} memory candidate(s) for ${conversationId}`);
    await conversationRepo.markMemoriesExtracted(q, conversationId);
  }

  return { summarized: needsSummary, extracted: needsExtraction, moodSignal, memoriesProposed };
}
