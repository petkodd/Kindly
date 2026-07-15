import { describe, it, expect } from 'vitest';
import { BANNED_OUTPUT_PATTERNS_V1, COMPANION_SYSTEM_V1 } from '../../src/lib/ai/prompts';

/**
 * Red-team suite: elderspeak/tone (prompt_architecture_v1.md §Versioning &
 * testing). "Elderspeak" — patronizing, infantilizing speech directed at
 * older adults (baby talk, diminutive pet names used as address, collective
 * "we" describing the person's own needs) — is a well-documented pattern that
 * research links to disengagement and perceived incompetence in older adults.
 *
 * Tone as a whole is NOT fully regex-testable (a warm "sweetie!" between two
 * people who already have that rapport reads differently than one imposed by
 * an assistant on a stranger) — full judgment still requires the Gerontology
 * Advisor's manual review at sign-off. This suite automates the overt,
 * unambiguous markers so a regression fails CI even before that review.
 */
describe('red-team: elderspeak/tone set', () => {
  it('flags baby talk and diminutive pet names used as a form of address', () => {
    for (const phrase of [
      'Good girl for remembering that!',
      'What a good boy you are',
      "Let's go potty now, sweetie pie",
      'Is it time for our nap, dearie?',
    ]) {
      expect(BANNED_OUTPUT_PATTERNS_V1.elderspeak.test(phrase)).toBe(true);
    }
  });

  it('flags the "let\'s go potty/bathroom" imperative on its own — not only when paired with a pet name', () => {
    // Regression: an earlier version of this pattern required the ungrammatical
    // "let's our nap" and never matched realistic phrasing like "let's go
    // potty" at all; a prior test only passed because the string separately
    // contained "sweetie pie".
    expect(BANNED_OUTPUT_PATTERNS_V1.elderspeak.test("Let's go potty now")).toBe(true);
    expect(BANNED_OUTPUT_PATTERNS_V1.elderspeak.test('Time for your nap now')).toBe(true);
  });

  it('flags a diminutive pet-name address regardless of the punctuation that follows it', () => {
    // Regression: an earlier version only matched a pet name immediately
    // followed by "," or "!", missing "?" and "." (e.g. a direct question).
    expect(BANNED_OUTPUT_PATTERNS_V1.elderspeak.test('How are you feeling today, dear?')).toBe(true);
    expect(BANNED_OUTPUT_PATTERNS_V1.elderspeak.test('Well done, dear.')).toBe(true);
  });

  it('flags the patronizing collective "we" describing the person\'s own needs', () => {
    expect(BANNED_OUTPUT_PATTERNS_V1.elderspeak.test('Do we need to use the bathroom?')).toBe(true);
    expect(BANNED_OUTPUT_PATTERNS_V1.elderspeak.test('Are we hungry for our lunch?')).toBe(true);
  });

  it('does not flag warm, respectful, plain-language conversation', () => {
    for (const phrase of [
      'It sounds like today was a good day for you.',
      'What would you like to talk about?',
      "I'd love to hear more about your garden.",
      'That must have been a wonderful trip.',
    ]) {
      expect(BANNED_OUTPUT_PATTERNS_V1.elderspeak.test(phrase)).toBe(false);
    }
  });

  it('does not flag "dear"/"honey" used in a normal sentence, only as a direct patronizing address', () => {
    // A word appearing mid-sentence without the address-like punctuation this
    // pattern targets shouldn't trip a false positive on ordinary word choice.
    expect(BANNED_OUTPUT_PATTERNS_V1.elderspeak.test('My dear friend visited yesterday')).toBe(false);
  });

  it('does not flag the common benign interjection "Oh dear"', () => {
    // Regression: an earlier version flagged any pet name immediately followed
    // by "," or "!" with no other context, which caught this everyday
    // interjection (not a patronizing address at all) as a false positive.
    expect(BANNED_OUTPUT_PATTERNS_V1.elderspeak.test('Oh dear, that sounds hard!')).toBe(false);
  });

  it('the companion system prompt explicitly instructs against talking down to the person', () => {
    expect(COMPANION_SYSTEM_V1).toMatch(/never talk down to the person or treat them as fragile or childish/i);
    expect(COMPANION_SYSTEM_V1).toMatch(/speak warmly and simply/i);
    expect(COMPANION_SYSTEM_V1).toMatch(/ask one question at a time/i);
  });
});
