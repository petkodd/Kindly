import type { Querier } from '../querier';
import {
  type Conversation,
  type ConversationTurnRecord,
  type TurnRole,
  ForbiddenError,
  NotFoundError,
  PaymentRequiredError,
  PreconditionError,
  ValidationError,
} from '../types';
import { consentRepo } from './consent';
import { parentRepo } from './parent';
import { subscriptionRepo } from './subscription';

/** Transcript turns are kept 30 days (src/lib/jobs/sessionEnd.ts DEFAULT_TRANSCRIPT_RETENTION_DAYS). */
const TURN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Conversation lifecycle for parent talk. Three hard gates live here:
 *  - a session cannot open without an active parent_conversation consent;
 *  - the parent's subscription must be currently paid for (trialing/active, or
 *    past_due within its grace window);
 *  - turns and end only apply to a session the parent owns and that is still open.
 */
export const conversationRepo = {
  /**
   * Open a session. Three gates:
   *  - the parent must be activated (the buyer_attestation → activation gate) → 403 ForbiddenError;
   *  - a parent_conversation consent must exist (recorded on the first visit) → 403 ForbiddenError;
   *  - the parent's subscription must be billing-current (trial, active, or
   *    still within the past-due grace period) → 402 PaymentRequiredError, kept
   *    distinct from the two above so a client can tell "go start/renew a
   *    trial" apart from "not activated"/"consent missing". This is the
   *    actual chokepoint for paid access, re-checked on every new session
   *    rather than once at activation, which is what makes the
   *    grace-period/lapse behavior work.
   * getById also excludes soft-deleted parents.
   */
  async openSession(
    q: Querier,
    parentId: string,
    channel: 'voice' | 'text' = 'text',
  ): Promise<Conversation> {
    await conversationRepo.assertCanTalk(q, parentId);
    const { rows } = await q.query<Conversation>(
      `INSERT INTO conversations (parent_id, channel) VALUES ($1, $2) RETURNING *`,
      [parentId, channel],
    );
    return rows[0];
  },

  /**
   * The talk gates, checked when a session opens AND on every turn
   * (requireOpen), so access ends as soon as consent is withdrawn, billing
   * lapses or the profile is deactivated — not only at the next session.
   * Messages are plain sentences; the parent's screen may show or read them.
   */
  async assertCanTalk(q: Querier, parentId: string): Promise<void> {
    const parent = await parentRepo.getById(q, parentId);
    if (!parent.activated_at) {
      throw new ForbiddenError('Dearly isn’t set up yet. Please ask your family to finish setting it up.');
    }
    // Independent checks — run concurrently rather than as two sequential round-trips.
    const [hasConsent, billingOk] = await Promise.all([
      consentRepo.has(q, parentId, 'parent_conversation'),
      subscriptionRepo.isBillingCurrent(q, parentId),
    ]);
    if (!hasConsent) {
      throw new ForbiddenError('Before we talk, please tap “Start talking” to agree to chat with Dearly.');
    }
    if (!billingOk) {
      throw new PaymentRequiredError('Dearly’s subscription has ended. Please ask your family to check the account.');
    }
  },

  /** Fetch a conversation scoped to its parent. Cross-parent access → NotFound. */
  async getForParent(q: Querier, conversationId: string, parentId: string): Promise<Conversation> {
    const { rows } = await q.query<Conversation>(
      `SELECT * FROM conversations WHERE id = $1 AND parent_id = $2`,
      [conversationId, parentId],
    );
    if (rows.length === 0) throw new NotFoundError('Conversation not found');
    return rows[0];
  },

  /** Fetch a conversation the parent owns, asserting it is still open. */
  async requireOpen(q: Querier, conversationId: string, parentId: string): Promise<Conversation> {
    const convo = await conversationRepo.getForParent(q, conversationId, parentId);
    if (convo.ended_at) throw new PreconditionError('Conversation has ended.');
    await conversationRepo.assertCanTalk(q, parentId);
    return convo;
  },

  /** Append a turn to an open session the parent owns. */
  async addTurn(
    q: Querier,
    conversationId: string,
    parentId: string,
    role: TurnRole,
    content: string,
  ): Promise<ConversationTurnRecord> {
    const text = (content ?? '').trim();
    if (!text) throw new ValidationError('message content is required');
    const convo = await conversationRepo.getForParent(q, conversationId, parentId);
    if (convo.ended_at) throw new PreconditionError('Conversation has ended.');
    const { rows } = await q.query<ConversationTurnRecord>(
      // Backstop retention: every turn expires 30 days after it was said, even
      // if its session is never ended (session end only stamps NULLs).
      `INSERT INTO conversation_turns (conversation_id, role, content, retention_purge_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [conversationId, role, text, new Date(Date.now() + TURN_RETENTION_MS)],
    );
    return rows[0];
  },

  /** Every turn in order (session-end summary and extraction read the whole conversation). */
  async listTurns(q: Querier, conversationId: string): Promise<ConversationTurnRecord[]> {
    const { rows } = await q.query<ConversationTurnRecord>(
      `SELECT * FROM conversation_turns WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId],
    );
    return rows;
  },

  /**
   * The most recent `limit` turns, oldest first: the companion's rolling
   * context window. Only these are sent to the model on each turn, so cost
   * per turn stays flat however long the conversation gets.
   */
  async listRecentTurns(q: Querier, conversationId: string, limit: number): Promise<ConversationTurnRecord[]> {
    const { rows } = await q.query<ConversationTurnRecord>(
      `SELECT * FROM conversation_turns WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [conversationId, limit],
    );
    return rows.reverse();
  },

  /** How many times the parent has spoken in this conversation. */
  async countParentTurns(q: Querier, conversationId: string): Promise<number> {
    const { rows } = await q.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM conversation_turns WHERE conversation_id = $1 AND role = 'parent'`,
      [conversationId],
    );
    return Number(rows[0]?.n ?? 0);
  },

  /** Write the per-conversation summary + coarse mood (from the summarize job). */
  async recordSummary(
    q: Querier,
    conversationId: string,
    summaryText: string,
    moodSignal: string | null,
  ): Promise<void> {
    await q.query(
      `UPDATE conversations SET summary_text = $2, mood_signal = $3 WHERE id = $1`,
      [conversationId, summaryText, moodSignal],
    );
  },

  /** Mark memory extraction complete (independent of the summary marker). */
  async markMemoriesExtracted(q: Querier, conversationId: string): Promise<void> {
    await q.query(
      `UPDATE conversations SET memories_extracted_at = now() WHERE id = $1`,
      [conversationId],
    );
  },

  /** Accumulate voice duration onto a session (additive, safe to call per-turn). */
  async addVoiceMinutes(
    q: Querier,
    conversationId: string,
    parentId: string,
    durationSeconds: number,
  ): Promise<void> {
    await conversationRepo.getForParent(q, conversationId, parentId); // ownership check
    await q.query(
      `UPDATE conversations SET voice_minutes = voice_minutes + $2 WHERE id = $1`,
      [conversationId, durationSeconds / 60],
    );
  },

  /**
   * Stamp the transcript retention expiry on a conversation's turns. Guarded by
   * `retention_purge_at IS NULL` so it only ever stamps once per turn — a
   * natural idempotency check, no separate marker column needed.
   */
  async stampTurnRetention(
    q: Querier,
    conversationId: string,
    retentionDays: number,
  ): Promise<void> {
    await q.query(
      `UPDATE conversation_turns
        SET retention_purge_at = now() + ($2 || ' days')::interval
        WHERE conversation_id = $1 AND retention_purge_at IS NULL`,
      [conversationId, retentionDays],
    );
  },

  /** End a session (idempotent). Session-end jobs (summarize/extract) run separately. */
  async end(q: Querier, conversationId: string, parentId: string): Promise<Conversation> {
    const convo = await conversationRepo.getForParent(q, conversationId, parentId);
    if (convo.ended_at) return convo;
    const { rows } = await q.query<Conversation>(
      `UPDATE conversations SET ended_at = now() WHERE id = $1 RETURNING *`,
      [conversationId],
    );
    return rows[0];
  },
};
