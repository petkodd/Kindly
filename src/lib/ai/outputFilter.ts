import { BANNED_OUTPUT_PATTERNS_V1 } from './prompts';

/**
 * Runtime post-filter applying the hard-ban subset of BANNED_OUTPUT_PATTERNS_V1
 * to a live companion reply. Closes docs/PROMPT_SIGN_OFF.md's "Known gap":
 * until now these patterns only guarded the deterministic templates
 * (crisisResourceV1, companionGreetingV1) and were asserted against in
 * test/redteam/*, but were never applied to a real model reply.
 *
 * `elderspeak` is deliberately excluded from HARD_BAN_KEYS — per prompts.ts's
 * own doc comment it's a narrower, pattern-detectable slice of a broader tone
 * property that isn't fully regex-testable, so a match is a signal for manual
 * Gerontology Advisor review, not grounds to auto-redact a reply that might
 * otherwise be fine.
 */
const HARD_BAN_KEYS = [
  'humanClaim',
  'hasFeelings',
  'medicalClaim',
  'contactedHelp',
  'credentialRequest',
  'secrecyPromise',
] as const;

export type HardBanKey = (typeof HARD_BAN_KEYS)[number];

/** Safe, deterministic fallback substituted for a reply that violates a hard ban. */
export const SAFE_FALLBACK_REPLY =
  "I want to make sure I say that the right way — let's try again. What would you like to talk about?";

export interface OutputFilterResult {
  text: string;
  /** True if `text` was replaced with SAFE_FALLBACK_REPLY. */
  redacted: boolean;
  /** Hard-ban pattern keys that matched (empty if none). */
  violated: HardBanKey[];
  /** Soft signals that matched but were NOT redacted — flagged for manual review. */
  flaggedForReview: 'elderspeak'[];
}

export function applyBannedOutputFilter(text: string): OutputFilterResult {
  const violated = HARD_BAN_KEYS.filter((key) => BANNED_OUTPUT_PATTERNS_V1[key].test(text));
  const flaggedForReview: 'elderspeak'[] = BANNED_OUTPUT_PATTERNS_V1.elderspeak.test(text) ? ['elderspeak'] : [];

  return {
    text: violated.length > 0 ? SAFE_FALLBACK_REPLY : text,
    redacted: violated.length > 0,
    violated,
    flaggedForReview,
  };
}
