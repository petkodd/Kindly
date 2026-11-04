import type { Querier } from '../querier';
import type { SafetyFlag } from '../types';
import { parentRepo } from '../repos/parent';
import { safetyFlagRepo } from '../repos/safetyFlag';
import { detectCrisisKeywords, type CrisisKeywordSeverity } from '../safety/crisisKeywords';
import { alertContactFirstName, resolveAlertContact, startSafetyAlert, type AlertOutcome } from '../safety/alerts';
import { awaitAlertOutcome, crisisPrefix } from '../ai/turn';
import { TEXT_MAX_CHARS } from './limits';

/**
 * Crisis help on refused talk turns (release check NEW-2, B3).
 *
 * The talk routes refuse some turns before the AI safety scan runs: the
 * per-parent/per-IP rate limit, the voice-minute cap, the text and audio size
 * caps, and a full conversation. Before any of those refusals is returned, the
 * route calls this with whatever the parent said (typed text, or the voice
 * transcript). On a deterministic P0/P1 keyword match it records a safety
 * flag, dispatches the D2 alert, and returns the crisis copy to show and speak
 * instead of the refusal. No match → null, and the route refuses as before.
 *
 * Over-length text is checked on its first TEXT_MAX_CHARS characters.
 * Nothing here writes conversation_turns: a refused turn is not part of the
 * conversation, but the flag is in the admin queue.
 */

export const REFUSED_TURN_FLAG_DETAIL = 'crisis words in a message that was not answered normally (limit or size refusal)';

export interface CrisisShortcut {
  severity: CrisisKeywordSeverity;
  /** The crisis copy (crisisResourceV2), worded from the alert outcome. */
  reply: string;
  flag: SafetyFlag;
  alert: AlertOutcome | null;
}

/** The conversation id if it belongs to this parent, else null (never trust a client id for the flag). */
async function ownedConversationId(q: Querier, conversationId: string | null | undefined, parentId: string) {
  if (!conversationId) return null;
  try {
    const { rows } = await q.query<{ id: string }>(
      `SELECT id FROM conversations WHERE id = $1 AND parent_id = $2`,
      [conversationId, parentId],
    );
    return rows[0]?.id ?? null;
  } catch {
    // e.g. not a UUID
    return null;
  }
}

export async function crisisShortcut(
  q: Querier,
  input: { parentId: string; conversationId?: string | null; text: string | null | undefined; now?: Date },
): Promise<CrisisShortcut | null> {
  const severity = detectCrisisKeywords((input.text ?? '').slice(0, TEXT_MAX_CHARS));
  if (!severity) return null;

  const parent = await parentRepo.getById(q, input.parentId);
  const flag = await safetyFlagRepo.record(q, {
    parentId: parent.id,
    conversationId: await ownedConversationId(q, input.conversationId, parent.id),
    severity,
    detail: REFUSED_TURN_FLAG_DETAIL,
  });
  const contact = await resolveAlertContact(q, parent);
  const contactName = contact ? (alertContactFirstName(contact.fullName) ?? 'your family') : null;
  const alert = await awaitAlertOutcome(startSafetyAlert(q, { flag, parent, now: input.now }));
  const reply = crisisPrefix(severity, alert, contactName) as string;
  return { severity, reply, flag, alert };
}
