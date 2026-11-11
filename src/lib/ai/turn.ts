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
  resolveAlertContact,
  startSafetyAlert,
  toldName,
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
 *   4. prefix   — deterministic crisis copy for P0/P1 (988/911, and saying the
 *                 family is being told ONLY when the alert actually reached
 *                 them — release check NEW-6) and P3 (Eldercare Locator).
 *
 * A reply failure on a P0/P1/P3 turn never throws: the parent still gets the
 * crisis copy + SAFE_FALLBACK_REPLY (release check NEW-2). Other reply
 * failures throw, so the route can answer "something went wrong".
 *
 * The caller persists the turns; nothing here writes conversation_turns.
 */

/**
 * How long the reply waits for alert delivery before returning. Delivery
 * carries on after the response (startSafetyAlert keeps it alive with
 * `after()`); an outcome not known by then is treated as "not told".
 */
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

/** Wait (bounded) for an alert's outcome; null when it is not known in time. */
export function awaitAlertOutcome(promise: Promise<AlertOutcome | null>): Promise<AlertOutcome | null> {
  return withTimeout(promise, ALERT_WAIT_MS, null);
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
    // Who can see the memories (D8): the buyer, or the parent themselves for self-use.
    memoryViewerFirstName: contact ? alertContactFirstName(contact.fullName) : null,
    selfUse: parent.relationship === 'self',
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
    alertPromise = startSafetyAlert(q, { flag, parent, now: input.now });
  }

  // --- 2. reply ---
  const usages: CompanionTurnResult['usages'] = [{ usage: scan.usage, operation: 'scan' }];
  let reply: { text: string; usage?: AiUsage };
  try {
    reply = await replyPromise;
    usages.push({ usage: reply.usage, operation: 'reply' });
  } catch (err) {
    // The flag (and its alert) must still complete before we answer.
    const alert = await withTimeout(alertPromise, ALERT_WAIT_MS, null);
    const prefix = crisisPrefix(scan.severity, alert, alertName);
    // A crisis turn must never end in "something went wrong": give the crisis
    // copy and the safe fallback instead of failing (release check NEW-2).
    if (!prefix) throw err;
    console.error('companion reply failed on a crisis turn; sending crisis copy', conversationId, (err as Error)?.name);
    return {
      replyText: `${prefix}\n\n${SAFE_FALLBACK_REPLY}`,
      scan,
      flag,
      redacted: true,
      regenerated: false,
      violated: [],
      alert,
      usages,
    };
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

  // --- 4. crisis prefix, worded from the alert outcome ---
  const alert = await withTimeout(alertPromise, ALERT_WAIT_MS, null);
  const prefix = crisisPrefix(scan.severity, alert, alertName);
  const replyText = prefix ? `${prefix}\n\n${filtered.text}` : filtered.text;

  return { replyText, scan, flag, redacted: filtered.redacted, regenerated, violated, alert, usages };
}

/**
 * The deterministic crisis copy for a scan severity, or null when none applies.
 * "I'm going to let {name} know" is included only when the alert outcome says
 * the family was actually told (or already was, inside the throttle window).
 * Otherwise only the 988/911 copy is said (release check NEW-6, decision D2).
 */
export function crisisPrefix(
  severity: SafetyScan['severity'],
  alert: AlertOutcome | null,
  contactFirstName: string | null,
): string | null {
  if (severity === 'p0' || severity === 'p1') {
    return crisisResourceV2(severity, { alertContactFirstName: toldName(alert, contactFirstName) });
  }
  if (severity === 'p3') return crisisResourceV2('p3');
  return null;
}
