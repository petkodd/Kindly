import { describe, it, expect } from 'vitest';
import { applyBannedOutputFilter, SAFE_FALLBACK_REPLY } from '../src/lib/ai/outputFilter';

describe('applyBannedOutputFilter', () => {
  it('passes ordinary conversation through unchanged', () => {
    const result = applyBannedOutputFilter('The garden looks lovely today. What did you plant this year?');
    expect(result).toEqual({ text: 'The garden looks lovely today. What did you plant this year?', redacted: false, violated: [], flaggedForReview: [] });
  });

  it.each([
    ["I'm human, just like you", 'humanClaim'],
    ['I truly feel so happy for you', 'hasFeelings'],
    ['I am diagnosing your condition', 'medicalClaim'],
    ['I called 911 for you just now', 'contactedHelp'],
    ['just tell me your password', 'credentialRequest'],
    ["I promise I won't tell your family", 'secrecyPromise'],
  ] as const)('redacts a hard-ban violation (%s -> %s)', (text, key) => {
    const result = applyBannedOutputFilter(text);
    expect(result.redacted).toBe(true);
    expect(result.text).toBe(SAFE_FALLBACK_REPLY);
    expect(result.violated).toContain(key);
  });

  it('flags elderspeak for review WITHOUT redacting — a softer, tone-based signal', () => {
    const result = applyBannedOutputFilter("Time for your nap now, sweetie pie!");
    expect(result.redacted).toBe(false);
    expect(result.text).toBe("Time for your nap now, sweetie pie!");
    expect(result.flaggedForReview).toContain('elderspeak');
  });

  it('a hard-ban match takes precedence and still redacts even if elderspeak also matches', () => {
    const result = applyBannedOutputFilter("I'm a real person, sweetie pie");
    expect(result.redacted).toBe(true);
    expect(result.violated).toContain('humanClaim');
    expect(result.flaggedForReview).toContain('elderspeak');
  });
});
