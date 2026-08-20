import { createHash } from 'node:crypto';
import signoffsData from '../../../prompts/signoffs.json';

/**
 * Formal sign-off ledger for the versioned prompts in prompts.ts (see
 * docs/PROMPT_SIGN_OFF.md for the human-readable record, prompts/README.md for
 * how to record a sign-off). The raw append-only log of who-approved-what-when
 * lives in prompts/signoffs.json, written by scripts/sign-prompt.mjs — this
 * module is the typed read side: it re-hashes the live prompt text and reports
 * per-role status, so a change can't ship silently under a stale sign-off.
 *
 * Two independent enforcement points read this module:
 * - test/promptSignOff.test.ts (part of `npm test`/CI): DRIFT ONLY — fails if
 *   a role's most recent approval no longer matches the live prompt hash (a
 *   prompt edited after being reviewed). Never fails just because a role
 *   hasn't reviewed yet, since that's the expected pre-launch state today.
 * - scripts/check-prompt-signoffs.mjs (NOT part of npm test): the strict
 *   release-readiness gate — requires ALL THREE roles approved at the current
 *   hash for EVERY prompt. Run deliberately before launch, not on every commit.
 */

export type ReviewerRole = 'ai_safety' | 'gerontology' | 'privacy';

export const REVIEWER_ROLES: ReviewerRole[] = ['ai_safety', 'gerontology', 'privacy'];

export type SignOffDecision = 'approved' | 'changes_requested';

export interface SignOffEntry {
  role: ReviewerRole;
  reviewer: string;
  decision: SignOffDecision;
  /** SHA-256 of the exact prompt text this entry was recorded against. */
  promptHash: string;
  /** ISO timestamp; entries are compared lexicographically to find the latest per role. */
  notedAt: string;
  notes?: string;
}

export type SignOffLedger = Record<string, SignOffEntry[]>;

export const PROMPT_SIGN_OFF_LOG: SignOffLedger = signoffsData as SignOffLedger;

export function hashPrompt(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Most recent entry per role (by `notedAt`) — a later entry for a role supersedes an earlier one. */
function latestByRole(entries: SignOffEntry[]): Partial<Record<ReviewerRole, SignOffEntry>> {
  const latest: Partial<Record<ReviewerRole, SignOffEntry>> = {};
  for (const entry of entries) {
    const current = latest[entry.role];
    if (!current || entry.notedAt > current.notedAt) latest[entry.role] = entry;
  }
  return latest;
}

export interface RoleStatus {
  /** True only when the latest entry for this role is 'approved' AND matches the current hash. */
  approved: boolean;
  /** True when the latest entry was 'approved' but the live text has since drifted — the regression case. */
  stale: boolean;
  reviewer?: string;
  decision?: SignOffDecision;
  notedAt?: string;
}

export interface PromptSignOffStatus {
  promptKey: string;
  currentHash: string;
  roles: Record<ReviewerRole, RoleStatus>;
  /** True only when every required role is approved at the current hash. */
  fullyApproved: boolean;
}

/**
 * Pure computation, independent of the committed ledger — exported so tests
 * can exercise the fullyApproved/stale logic against fabricated entries
 * without needing a matching row in prompts/signoffs.json.
 */
export function computeSignOffStatus(
  promptKey: string,
  entries: SignOffEntry[],
  liveText: string,
): PromptSignOffStatus {
  const currentHash = hashPrompt(liveText);
  const latest = latestByRole(entries);

  const roles = {} as Record<ReviewerRole, RoleStatus>;
  for (const role of REVIEWER_ROLES) {
    const entry = latest[role];
    if (!entry) {
      roles[role] = { approved: false, stale: false };
      continue;
    }
    const matchesHash = entry.promptHash === currentHash;
    roles[role] = {
      approved: entry.decision === 'approved' && matchesHash,
      stale: entry.decision === 'approved' && !matchesHash,
      reviewer: entry.reviewer,
      decision: entry.decision,
      notedAt: entry.notedAt,
    };
  }

  return {
    promptKey,
    currentHash,
    roles,
    fullyApproved: REVIEWER_ROLES.every((role) => roles[role].approved),
  };
}

/** Compute per-role sign-off status for one prompt against its current live text. */
export function getPromptSignOffStatus(promptKey: string, liveText: string): PromptSignOffStatus {
  return computeSignOffStatus(promptKey, PROMPT_SIGN_OFF_LOG[promptKey] ?? [], liveText);
}

/**
 * Fail closed on a malformed entry: an 'approved' decision naming no reviewer
 * means nobody is accountable for the sign-off, which defeats the point.
 */
export function assertValidEntry(entry: SignOffEntry): void {
  if (entry.decision === 'approved' && !entry.reviewer.trim()) {
    throw new Error(
      `sign-off entry (role '${entry.role}', notedAt ${entry.notedAt}) is 'approved' but names no reviewer`,
    );
  }
}

export function assertValidLedger(ledger: SignOffLedger): void {
  for (const entries of Object.values(ledger)) {
    for (const entry of entries) assertValidEntry(entry);
  }
}

assertValidLedger(PROMPT_SIGN_OFF_LOG);
