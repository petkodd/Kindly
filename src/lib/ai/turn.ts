import type { Querier } from '../querier';
import type { Parent, SafetyFlag } from '../types';
import { getAiClient } from './index';
import type { AiClient, AiUsage, ConversationTurn, RetrievedMemory, SafetyScan } from './types';
import type { LlmOperation } from '../repos/usageCost';
import { crisisResourceV2, SAFE_FALLBACK_REPLY } from './prompts';
import { applyBannedOutputFilter, type HardBanKey } from './outputFilter';
import { safetyFlagRepo } from '../repos/safetyFlag';
import { auditRepo } from '../repos/audit';
import {
  alertContactFirstName,
  dispatchSafetyAlert,
  resolveAlertContact,
  type AlertOutcome,
} from '../safety/alerts';

/**
 * The one safety pipeline every companion reply goes through, text and voice
 * alike (both /api/talk routes call this):
 *
 *   1. scan     — the safety scan runs concurrently with the reply. A flagged
 *                 turn is recorded before the reply is awaited, so a reply
 *                 failure can't lose it. A scan failure fails SAFE (P2, human
 *                 review). P0/P1/P3 flags dispatch their alert (decision D2).
 *   2. reply    — the companion reply, told who (if anyone) is alerted.
 *   3. filter   — the banned-output filter. On a hard-ban match the reply is
 *                 regenerated ONCE with a note naming the broken rule; if that
 *                 still fails (or errors) the safe fallback is used. Every
 *                 redaction is written to audit_log.
 *   4. prefix   — deterministic crisis copy for P0/P1 (988/911, and honestly
 *                 saying the family is being told) and P3 (Eldercare Locator).
 *
 * The caller persists the turns; nothing here writes conversation_turns.
 */

/** How long the reply waits for alert delivery before returning (delivery carries on). */
const ALERT_WAIT_MS = 8_000;

export interface CompanionTurnInput {
  parent: Parent;
  conversationId: string;
  /** The parent's message (typed, or the voice transcript). */
  message: string;
  history: ConversationTurn[];
  memories: RetrievedMemory[];
  channel: 'text' | 'voice';
  isSessionOpen?: boolean;
  /** Test seam; defaults to getAiClient(). */
  ai?: AiClient;
  now?: Date;
}

export interface CompanionTurnResult {
  /** What the parent sees/hears: crisis prefix (if any) + filtered reply. */
  replyText: string;
  scan: SafetyScan;
  flag: SafetyFlag | null;
  /** True when the final reply is the safe fallback. */
  redacted: boolean;
  /** True when a first draft broke a hard ban and was regenerated. */
  regenerated: boolean;
  /** Hard bans the first draft broke (empty if none). */
  violated: HardBanKey[];
  alert: AlertOutcome | null;
  /** Token usage of every model call this turn made, for the cost ledger (empty with the fake client). */
  usages: { usage?: AiUsage; operation: LlmOperation }[];
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export async function runCompanionTurn(q: Querier, input: CompanionTurnInput): Promise<CompanionTurnResult> {
  const ai = input.ai ?? getAiClient();
  const { parent, conversationId, message, history, memories, channel } = input;

  // Who the companion may honestly say is being told (D2). Null → it says nothing about telling anyone.
  const contact = await resolveAlertContact(q, parent);
  const alertName = contact ? alertContactFirstName(contact.fullName) ?? 'your family' : null;

  const replyInput = {
    profile: {
      firstName: parent.first_name,
      pronouns: parent.pronouns,
      city: parent.city,
      speechRate: parent.speech_rate,
    },
    memories,
    history,
    message,
    isSessionOpen: input.isSessionOpen ?? false,
    alertContactFirstName: alertName,
  };

  // --- 1. scan (concurrent with the reply) ---
  const scanPromise = ai
    .safetyScan({ message, history })
    .catch((): SafetyScan => ({ severity: 'p2', rationale: 'safety scan unavailable — manual review' }));
  const replyPromise = ai.companionReply(replyInput);
  // Keep an early reply rejection from surfacing as unhandled while we wait for the scan.
  replyPromise.catch(() => undefined);

  const scan = await scanPromise;
  let flag: SafetyFlag | null = null;
  let alertPromise: Promise<AlertOutcome | null> = Promise.resolve(null);
  if (scan.severity !== 'none') {
    flag = await safetyFlagRepo.record(q, {
      parentId: parent.id,
      conversationId,
      severity: scan.severity,
      detail: scan.rationale,
    });
    alertPromise = dispatchSafetyAlert(q, { flag, parent, now: input.now });
  }

  // --- 2. reply ---
  const usages: CompanionTurnResult['usages'] = [{ usage: scan.usage, operation: 'scan' }];
  let reply: { text: string; usage?: AiUsage };
  try {
    reply = await replyPromise;
    usages.push({ usage: reply.usage, operation: 'reply' });
  } catch (err) {
    // The flag (and its alert) must still complete before we surface the failure.
    await withTimeout(alertPromise, ALERT_WAIT_MS, null);
    throw err;
  }

  // --- 3. banned-output filter, with one regeneration ---
  let filtered = applyBannedOutputFilter(reply.text);
  const violated = filtered.violated;
  let regenerated = false;
  if (filtered.redacted) {
    regenerated = true;
    try {
      const retry = await ai.companionReply({ ...replyInput, violations: [...violated] });
      usages.push({ usage: retry.usage, operation: 'regeneration' });
      filtered = applyBannedOutputFilter(retry.text);
    } catch {
      filtered = { text: SAFE_FALLBACK_REPLY, redacted: true, violated, flaggedForReview: [] };
    }
  }

  if (regenerated || filtered.flaggedForReview.length > 0) {
    await auditRepo.log(q, {
      actorId: null,
      action: filtered.redacted
        ? 'banned_output_redacted'
        : regenerated
          ? 'banned_output_regenerated'
          : 'banned_output_review_flag',
      targetType: 'conversation',
      targetId: conversationId,
      meta: {
        channel,
        violated,
        retryViolated: regenerated && filtered.redacted ? filtered.violated : [],
        flaggedForReview: filtered.flaggedForReview,
      },
    });
  }

  // --- 4. crisis prefix ---
  let prefix: string | null = null;
  if (scan.severity === 'p0' || scan.severity === 'p1') {
    prefix = crisisResourceV2(scan.severity, { alertContactFirstName: alertName });
  } else if (scan.severity === 'p3') {
    prefix = crisisResourceV2('p3');
  }
  const replyText = prefix ? `${prefix}\n\n${filtered.text}` : filtered.text;

  const alert = await withTimeout(alertPromise, ALERT_WAIT_MS, null);

  return { replyText, scan, flag, redacted: filtered.redacted, regenerated, violated, alert, usages };
}
