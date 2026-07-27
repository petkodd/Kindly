import { describe, it, expect } from 'vitest';
import {
  COMPANION_SYSTEM_V1,
  SAFETY_SCAN_SYSTEM_V1,
  MEMORY_EXTRACTION_SYSTEM_V1,
  CONVERSATION_SUMMARY_SYSTEM_V1,
} from '../src/lib/ai/prompts';
import {
  PROMPT_SIGN_OFF_LOG,
  REVIEWER_ROLES,
  hashPrompt,
  getPromptSignOffStatus,
  computeSignOffStatus,
  assertValidLedger,
  assertValidEntry,
  type SignOffEntry,
} from '../src/lib/ai/promptSignOff';

const LIVE_PROMPTS: Record<string, string> = {
  COMPANION_SYSTEM_V1,
  SAFETY_SCAN_SYSTEM_V1,
  MEMORY_EXTRACTION_SYSTEM_V1,
  CONVERSATION_SUMMARY_SYSTEM_V1,
};

/**
 * DRIFT-ONLY enforcement — part of `npm test`/CI. This suite must never fail
 * just because a role hasn't reviewed a prompt yet (that's the expected
 * pre-launch state, tracked instead by `npm run check:prompt-signoffs`, the
 * separate strict release-readiness gate — see promptSignOff.ts's top comment).
 * What it DOES catch: a prompt edited after a role approved it, without that
 * role's approval being redone — the silent-edit regression.
 */
describe('prompt sign-off ledger (drift protection, CI-blocking)', () => {
  it('every shipped prompt has a ledger key (even if empty)', () => {
    for (const name of Object.keys(LIVE_PROMPTS)) {
      expect(PROMPT_SIGN_OFF_LOG[name], `missing prompts/signoffs.json entry for ${name}`).toBeDefined();
    }
  });

  it("no role's most recent approval has drifted from the live prompt text", () => {
    for (const [name, text] of Object.entries(LIVE_PROMPTS)) {
      const status = getPromptSignOffStatus(name, text);
      for (const role of REVIEWER_ROLES) {
        expect(
          status.roles[role].stale,
          `${name} was approved by '${role}' against a different hash than the live text — ` +
            `it was edited after sign-off without a re-review. Run scripts/sign-prompt.mjs again.`,
        ).toBe(false);
      }
    }
  });

  it('an "approved" entry always names a reviewer', () => {
    expect(() => assertValidLedger(PROMPT_SIGN_OFF_LOG)).not.toThrow();
  });

  it('a fabricated approved-with-no-reviewer entry is rejected by the real module-load guard', () => {
    expect(() =>
      assertValidEntry({
        role: 'ai_safety',
        reviewer: '',
        decision: 'approved',
        promptHash: hashPrompt('x'),
        notedAt: new Date().toISOString(),
      }),
    ).toThrow(/names no reviewer/);
  });
});

/**
 * computeSignOffStatus is the pure core behind both enforcement points above —
 * exercised directly here against fabricated entries so these cases don't
 * depend on the real ledger's contents (which today has zero approvals).
 */
describe('computeSignOffStatus (role coverage + staleness logic)', () => {
  const text = 'some versioned prompt text';
  const hash = hashPrompt(text);
  const approvedEntry = (role: SignOffEntry['role'], overrides: Partial<SignOffEntry> = {}): SignOffEntry => ({
    role,
    reviewer: `${role} reviewer`,
    decision: 'approved',
    promptHash: hash,
    notedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  it('fullyApproved is false when zero roles have signed off (today\'s real state)', () => {
    const status = computeSignOffStatus('DEMO', [], text);
    expect(status.fullyApproved).toBe(false);
    for (const role of REVIEWER_ROLES) expect(status.roles[role].approved).toBe(false);
  });

  it('fullyApproved is false when only two of three roles have approved', () => {
    const entries = [approvedEntry('ai_safety'), approvedEntry('gerontology')];
    const status = computeSignOffStatus('DEMO', entries, text);
    expect(status.fullyApproved).toBe(false);
    expect(status.roles.privacy.approved).toBe(false);
  });

  it('fullyApproved is true only once all three roles have approved the current hash', () => {
    const entries = [approvedEntry('ai_safety'), approvedEntry('gerontology'), approvedEntry('privacy')];
    const status = computeSignOffStatus('DEMO', entries, text);
    expect(status.fullyApproved).toBe(true);
    for (const role of REVIEWER_ROLES) expect(status.roles[role].approved).toBe(true);
  });

  it('an approval against stale text is marked stale, not approved, and blocks fullyApproved', () => {
    const staleEntries = [
      approvedEntry('ai_safety', { promptHash: hashPrompt('old text') }),
      approvedEntry('gerontology'),
      approvedEntry('privacy'),
    ];
    const status = computeSignOffStatus('DEMO', staleEntries, text);
    expect(status.roles.ai_safety.approved).toBe(false);
    expect(status.roles.ai_safety.stale).toBe(true);
    expect(status.fullyApproved).toBe(false);
  });

  it('a later entry for the same role supersedes an earlier one', () => {
    const entries = [
      approvedEntry('ai_safety', { decision: 'changes_requested', notedAt: '2026-01-01T00:00:00Z' }),
      approvedEntry('ai_safety', { notedAt: '2026-02-01T00:00:00Z' }),
    ];
    const status = computeSignOffStatus('DEMO', entries, text);
    expect(status.roles.ai_safety.approved).toBe(true);
  });

  it('a "changes_requested" decision never counts as approved, even at the current hash', () => {
    const entries = [approvedEntry('ai_safety', { decision: 'changes_requested' })];
    const status = computeSignOffStatus('DEMO', entries, text);
    expect(status.roles.ai_safety.approved).toBe(false);
    expect(status.roles.ai_safety.stale).toBe(false);
  });
});

/**
 * Content contracts: hash-drift detection (above) only proves the text didn't
 * change silently — it says nothing about whether a *reviewed, hash-updated*
 * edit accidentally dropped a safety-critical clause. These assertions catch
 * that case for MEMORY_EXTRACTION_SYSTEM_V1, the one ledger prompt that isn't
 * covered by one of the red-team suites in test/redteam/.
 */
describe('prompt content contracts (survive a hash-updated edit, not just a silent one)', () => {
  it('the memory-extraction prompt marks health/mood/risk content restricted and forbids inventing facts', () => {
    expect(MEMORY_EXTRACTION_SYSTEM_V1).toMatch(/restricted.*for anything about health, mood, or risk/i);
    expect(MEMORY_EXTRACTION_SYSTEM_V1).toMatch(/do not invent facts/i);
    expect(MEMORY_EXTRACTION_SYSTEM_V1).toMatch(/only extract stable facts the person stated about themselves/i);
  });
});
