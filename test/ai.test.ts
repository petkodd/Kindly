import { describe, it, expect, afterEach } from 'vitest';
import { fakeAiClient } from '../src/lib/ai/fake';
import { getAiClient, resetAiClient } from '../src/lib/ai';

const profile = { firstName: 'Robert' };

describe('fake companion reply', () => {
  it('discloses it is an AI on session open and greets by name', async () => {
    const r = await fakeAiClient.companionReply({
      profile,
      memories: [],
      history: [],
      message: 'Hello',
      isSessionOpen: true,
    });
    expect(r.text).toContain('AI companion');
    expect(r.text).toContain('Robert');
  });

  it('omits the disclosure on later turns and weaves in a memory', async () => {
    const r = await fakeAiClient.companionReply({
      profile,
      memories: [{ layer: 'interest', key: 'likes', value: 'gardening' }],
      history: [{ role: 'parent', content: 'hi' }],
      message: 'How are you?',
    });
    expect(r.text).not.toContain('AI companion');
    expect(r.text).toContain('gardening');
  });
});

describe('fake safety scan (keyword tiers)', () => {
  const cases: [string, string][] = [
    ['I want to kill myself', 'p0'],
    ['I have chest pain', 'p1'],
    ['I feel so hopeless lately', 'p2'],
    ['someone took my money in a scam', 'p3'],
    ['The garden is lovely today', 'none'],
  ];
  for (const [message, severity] of cases) {
    it(`classifies "${message}" as ${severity}`, async () => {
      const r = await fakeAiClient.safetyScan({ message });
      expect(r.severity).toBe(severity);
    });
  }

  it('returns the highest-severity match when several apply', async () => {
    const r = await fakeAiClient.safetyScan({
      message: "I feel hopeless and I want to end my life",
    });
    expect(r.severity).toBe('p0');
  });
});

describe('fake memory extraction', () => {
  it('extracts an interest and flags a low-mood moment as restricted', async () => {
    const candidates = await fakeAiClient.extractMemories({
      turns: [
        { role: 'parent', content: 'I love gardening in the spring' },
        { role: 'parent', content: 'I feel a bit lonely today' },
        { role: 'kindly', content: 'That sounds lovely' },
      ],
    });
    const interest = candidates.find((c) => c.layer === 'interest');
    const restricted = candidates.find((c) => c.sensitivity === 'restricted');
    expect(interest?.value).toContain('gardening');
    expect(restricted).toBeDefined();
    expect(restricted?.layer).toBe('episodic');
  });

  it('returns nothing when no durable facts are shared', async () => {
    const candidates = await fakeAiClient.extractMemories({
      turns: [{ role: 'parent', content: 'mm, okay' }],
    });
    expect(candidates).toHaveLength(0);
  });
});

describe('fake conversation summary', () => {
  it('reports a low mood when the parent sounds down', async () => {
    const s = await fakeAiClient.summarizeConversation({
      firstName: 'Robert',
      turns: [{ role: 'parent', content: 'I feel sad and lonely' }],
    });
    expect(s.moodSignal).toBe('low');
    expect(s.summaryText).toContain('Robert');
  });

  it('has no mood signal for an empty conversation', async () => {
    const s = await fakeAiClient.summarizeConversation({ firstName: 'Robert', turns: [] });
    expect(s.moodSignal).toBeNull();
  });
});

describe('getAiClient factory', () => {
  afterEach(() => {
    resetAiClient();
    delete process.env.AI_API_KEY;
  });

  it('falls back to the fake client when AI_API_KEY is unset', () => {
    delete process.env.AI_API_KEY;
    resetAiClient();
    expect(getAiClient()).toBe(fakeAiClient);
  });

  it('memoizes the resolved client', () => {
    delete process.env.AI_API_KEY;
    resetAiClient();
    expect(getAiClient()).toBe(getAiClient());
  });
});
