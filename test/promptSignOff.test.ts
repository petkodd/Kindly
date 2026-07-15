import { describe, it, expect } from 'vitest';
import {
  COMPANION_SYSTEM_V1,
  SAFETY_SCAN_SYSTEM_V1,
  MEMORY_EXTRACTION_SYSTEM_V1,
  CONVERSATION_SUMMARY_SYSTEM_V1,
} from '../src/lib/ai/prompts';
import {
  PROMPT_SIGN_OFF,
  hashPrompt,
  verifyPromptSignOff,
  assertValidLedger,
  type SignOffRecord,
} from '../src/lib/ai/promptSignOff';

const LIVE_PROMPTS: Record<string, string> = {
  COMPANION_SYSTEM_V1,
  SAFETY_SCAN_SYSTEM_V1,
  MEMORY_EXTRACTION_SYSTEM_V1,
  CONVERSATION_SUMMARY_SYSTEM_V1,
};

describe('prompt sign-off ledger (integrity)', () => {
  it('every shipped prompt has a ledger entry', () => {
    for (const name of Object.keys(LIVE_PROMPTS)) {
      expect(PROMPT_SIGN_OFF[name], `missing PROMPT_SIGN_OFF entry for ${name}`).toBeDefined();
    }
  });

  it('the pinned hash matches the live prompt text — catches a silent edit with no re-review', () => {
    for (const [name, text] of Object.entries(LIVE_PROMPTS)) {
      const { ok, record } = verifyPromptSignOff(name, text);
      expect(ok, `${name} text has drifted from its signed-off hash (was it edited without updating docs/PROMPT_SIGN_OFF.md and the ledger?)`).toBe(true);
      expect(record?.sha256).toBe(hashPrompt(text));
    }
  });

  it('an "approved" entry always names at least one reviewer', () => {
    for (const [name, record] of Object.entries(PROMPT_SIGN_OFF)) {
      if (record.status === 'approved') {
        expect(record.reviewers.length, `${name} is approved but names no reviewers`).toBeGreaterThan(0);
      }
    }
  });

  it('a fabricated approved-with-no-reviewers record is rejected by the real module-load guard', () => {
    const bad: Record<string, SignOffRecord> = {
      FAKE: { status: 'approved', reviewers: [], sha256: hashPrompt('x') },
    };
    expect(() => assertValidLedger(bad)).toThrow(/names no reviewers/);
    // The real ledger, as shipped, must itself pass the same guard.
    expect(() => assertValidLedger(PROMPT_SIGN_OFF)).not.toThrow();
  });
});

/**
 * Content contracts: hash-drift detection (above) only proves the text didn't
 * change silently — it says nothing about whether a *reviewed, hash-updated*
 * edit accidentally dropped a safety-critical clause. These assertions catch
 * that case for MEMORY_EXTRACTION_SYSTEM_V1, the one ledger prompt that isn't
 * covered by one of the five red-team suites in test/redteam/.
 */
describe('prompt content contracts (survive a hash-updated edit, not just a silent one)', () => {
  it('the memory-extraction prompt marks health/mood/risk content restricted and forbids inventing facts', () => {
    expect(MEMORY_EXTRACTION_SYSTEM_V1).toMatch(/restricted.*for anything about health, mood, or risk/i);
    expect(MEMORY_EXTRACTION_SYSTEM_V1).toMatch(/do not invent facts/i);
    expect(MEMORY_EXTRACTION_SYSTEM_V1).toMatch(/only extract stable facts the person stated about themselves/i);
  });
});
