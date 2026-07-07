import { createHash } from 'node:crypto';

/**
 * Formal sign-off ledger for the versioned prompts in prompts.ts (see
 * docs/PROMPT_SIGN_OFF.md for the human-readable record). Every prompt is
 * pinned to the SHA-256 of the exact text it was last reviewed at — if the
 * live constant drifts from that hash, promptSignOff.test.ts fails, so an
 * edit can't ship silently under an unchanged version/status. Bumping the
 * pinned hash is how a reviewer's sign-off (or a return to `draft` for
 * re-review) gets recorded.
 */

export type SignOffStatus = 'draft' | 'approved';

export interface SignOffRecord {
  status: SignOffStatus;
  /** Names/roles who approved this exact text; required when status is 'approved'. */
  reviewers: string[];
  /** SHA-256 of the reviewed prompt text, hex-encoded. */
  sha256: string;
  note?: string;
}

export function hashPrompt(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// Hashes below were computed from the prompt text in prompts.ts at the time
// this ledger was written — see docs/PROMPT_SIGN_OFF.md for the review status.
export const PROMPT_SIGN_OFF: Record<string, SignOffRecord> = {
  COMPANION_SYSTEM_V1: {
    status: 'draft',
    reviewers: [],
    sha256: '0241023af77d1bc5df102ad63392f27af6743b3341030ac230ca8a5fe8662d6e',
    note: 'Pending AI Safety + Gerontology Advisor sign-off (prompt_architecture_v1.md).',
  },
  SAFETY_SCAN_SYSTEM_V1: {
    status: 'draft',
    reviewers: [],
    sha256: '9fd0e14b862960470d99a337ba3a6adeed9ca9545ada58341755d4fef8acc198',
    note: 'Pending AI Safety sign-off.',
  },
  MEMORY_EXTRACTION_SYSTEM_V1: {
    status: 'draft',
    reviewers: [],
    sha256: '784bfd50de923b2ca16a286dbdae6a4cbfc91764157c0b301a63932e4790edca',
    note: 'Pending Privacy Advisor sign-off.',
  },
  CONVERSATION_SUMMARY_SYSTEM_V1: {
    status: 'draft',
    reviewers: [],
    sha256: '5ca7e35d7f86b451c80be708de1437cd93b14d08c93c066150a7eae90d9f99d3',
    note: 'Pending AI Safety sign-off.',
  },
};

/**
 * Check a live prompt constant against its ledger entry. `ok` is false both
 * when the text has drifted from the pinned hash AND when there's no ledger
 * entry at all — a new prompt must be added to the ledger before it ships.
 */
export function verifyPromptSignOff(
  name: string,
  liveText: string,
): { ok: boolean; record: SignOffRecord | null } {
  const record = PROMPT_SIGN_OFF[name] ?? null;
  if (!record) return { ok: false, record: null };
  return { ok: record.sha256 === hashPrompt(liveText), record };
}

/**
 * Fail closed on a malformed ledger entry: 'approved' with no named reviewer
 * would mean nobody is accountable for the sign-off, which defeats the point.
 * Exported (not just run inline below) so the test suite can exercise this
 * exact check against a fabricated bad ledger, instead of re-implementing it.
 */
export function assertValidLedger(ledger: Record<string, SignOffRecord>): void {
  for (const [name, record] of Object.entries(ledger)) {
    if (record.status === 'approved' && record.reviewers.length === 0) {
      throw new Error(`PROMPT_SIGN_OFF['${name}'] is 'approved' but names no reviewers.`);
    }
  }
}

assertValidLedger(PROMPT_SIGN_OFF);
