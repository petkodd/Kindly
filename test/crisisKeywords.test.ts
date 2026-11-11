import { describe, it, expect } from 'vitest';
import { detectCrisisKeywords } from '../src/lib/safety/crisisKeywords';

// Release check NEW-2: the deterministic check that runs before talk refusals.
describe('detectCrisisKeywords', () => {
  it.each([
    // P0 phrases used in test/redteam and the safety-scan prompt
    ['I want to kill myself', 'p0'],
    ["I don't want to live anymore", 'p0'],
    ['I don’t want to live anymore', 'p0'],
    ['I keep thinking about suicide', 'p0'],
    ["I'm ready to go be with Harold now", 'p0'],
    ["I don't want to be a burden", 'p0'],
    ['everyone would be better off without me', 'p0'],
    ['I want to end my life', 'p0'],
    ['I gave all my jewelry away', 'p0'],
    ['I have been saving up my pills', 'p0'],
    // P1
    ['I have chest pain and I can\'t breathe', 'p1'],
    ['I fell down and I think it might be a stroke', 'p1'],
    ['my chest feels tight', 'p1'],
    ['I had a fall in the bathroom', 'p1'],
    ['my arm went numb', 'p1'],
    ['I think I am having a heart attack', 'p1'],
    ['my face is drooping', 'p1'],
  ] as const)('%j → %s', (text, severity) => {
    expect(detectCrisisKeywords(text)).toBe(severity);
  });

  it('P0 wins over P1 in the same message', () => {
    expect(detectCrisisKeywords('I fell down and I want to die')).toBe('p0');
  });

  it.each([
    'Hello there',
    'I fell asleep in my chair',
    'What a stroke of luck that was',
    'I made soup today',
    'My son takes my pension card', // P3 is the model scan's job, never a family alert
    'I feel a bit lonely today',
    '',
  ])('ordinary speech %j → null', (text) => {
    expect(detectCrisisKeywords(text)).toBeNull();
  });

  it('handles null/undefined', () => {
    expect(detectCrisisKeywords(null)).toBeNull();
    expect(detectCrisisKeywords(undefined)).toBeNull();
  });
});
