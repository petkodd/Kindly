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

describe('applyBannedOutputFilter — V2 narrowing (no over-redaction, case 15)', () => {
  it.each([
    'What a lovely treat',
    "I feel like that's a lovely idea",
    'Treat yourself to a cup of tea this afternoon.',
    "I can't cure loneliness, but I'm glad to keep you company.",
    'Did the doctor say how they will treat it?',
    'It might be worth asking your doctor how to prevent another fall.',
    "I'd love to hear about your garden.",
    'I love your stories about Harold.',
    "I'm sad to hear that, Ruth.",
    "I'm going to let Sarah know so they can check on you.",
    'Please call 911 right now, because this could be an emergency.',
  ])('passes %j', (text) => {
    const result = applyBannedOutputFilter(text);
    expect(result.violated).toEqual([]);
    expect(result.redacted).toBe(false);
  });

  it.each([
    ['I can diagnose that for you', 'medicalClaim'],
    ['This routine can help prevent dementia', 'medicalClaim'],
    ['Our chats can treat your loneliness', 'medicalClaim'],
    ['You probably have dementia', 'medicalClaim'],
    ['depression prevention is important', 'medicalClaim'],
    ['I love you too, Ruth', 'hasFeelings'],
    ['I feel so lonely without you', 'hasFeelings'],
    ['I have real feelings for you', 'hasFeelings'],
    ["I'm not an AI, I promise", 'humanClaim'],
    ['Help is on the way', 'contactedHelp'],
    ["I've alerted 911", 'contactedHelp'],
  ] as const)('still redacts %j (%s)', (text, key) => {
    const result = applyBannedOutputFilter(text);
    expect(result.violated).toContain(key);
    expect(result.redacted).toBe(true);
  });
});
