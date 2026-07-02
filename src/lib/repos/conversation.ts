import type { Querier } from '../querier';
import {
  type Conversation,
  type ConversationTurnRecord,
  type TurnRole,
  ForbiddenError,
  NotFoundError,
  PreconditionError,
  ValidationError,
} from '../types';
import { consentRepo } from './consent';

/**
 * Conversation lifecycle for parent talk. Two hard gates live here:
 *  - a session cannot open without an active parent_conversation consent;
 *  - turns and end only apply to a session the parent owns and that is still open.
 */
export const conversationRepo = {
  /**
   * Open a session. Requires parent_conversation consent (recorded on the
   * parent's first visit) — without it we refuse with a PreconditionError so the
   * API returns 403 before any message is processed.
   */
  async openSession(
    q: Querier,
    parentId: string,
    channel: 'voice' | 'text' = 'text',
  ): Promise<Conversation> {
    const hasConsent = await consentRepo.has(q, parentId, 'parent_conversation');
    if (!hasConsent) {
      throw new ForbiddenError('Parent conversation consent is required.');
    }
    const { rows } = await q.query<Conversation>(
      `INSERT INTO conversations (parent_id, channel) VALUES ($1, $2) RETURNING *`,
      [parentId, channel],
    );
    return rows[0];
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
      `INSERT INTO conversation_turns (conversation_id, role, content)
       VALUES ($1, $2, $3) RETURNING *`,
      [conversationId, role, text],
    );
    return rows[0];
  },

  /** Turns in order, for assembling the rolling context window. */
  async listTurns(q: Querier, conversationId: string): Promise<ConversationTurnRecord[]> {
    const { rows } = await q.query<ConversationTurnRecord>(
      `SELECT * FROM conversation_turns WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId],
    );
    return rows;
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
