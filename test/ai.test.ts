import { describe, it, expect, afterEach } from 'vitest';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { fakeAiClient } from '../src/lib/ai/fake';
import { getAiClient, resetAiClient } from '../src/lib/ai';
import { AiError } from '../src/lib/ai/types';
import { parseJson, requireText, buildCompanionMessages } from '../src/lib/ai/anthropic';

// Minimal Message stand-in for testing the response guards.
function msg(text: string, stopReason: Message['stop_reason'] = 'end_turn'): Message {
  return {
    content: text ? [{ type: 'text', text, citations: null }] : [],
    stop_reason: stopReason,
  } as unknown as Message;
}

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

describe('anthropic client response guards', () => {
  it('requireText throws AiError on a refusal', () => {
    expect(() => requireText(msg('', 'refusal'), 'safetyScan')).toThrow(AiError);
  });

  it('requireText throws AiError on an empty body', () => {
    expect(() => requireText(msg(''), 'companionReply')).toThrow(AiError);
  });

  it('parseJson throws AiError (not SyntaxError) on truncated JSON', () => {
    const err = (() => {
      try {
        parseJson(msg('{"severity":"p0"', 'max_tokens'), 'safetyScan');
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(AiError);
    expect((err as Error).message).toContain('truncated');
  });

  it('parseJson returns the value on well-formed output', () => {
    const out = parseJson<{ severity: string }>(msg('{"severity":"none"}'), 'safetyScan');
    expect(out.severity).toBe('none');
  });
});

describe('buildCompanionMessages (real-client assembly)', () => {
  it('starts the messages array with the user, dropping a leading greeting turn', () => {
    // First parent message of a session: history is just the stored kindly greeting.
    const messages = buildCompanionMessages({
      profile: { firstName: 'Robert' },
      memories: [],
      history: [{ role: 'kindly', content: 'Hello, I am Kindly (an AI).' }],
      message: 'Hi there',
    });
    expect(messages[0].role).toBe('user'); // never assistant-led → no Anthropic 400
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'Hi there' });
  });

  it('preserves an alternating history that already starts with the parent', () => {
    const messages = buildCompanionMessages({
      profile: { firstName: 'Robert' },
      memories: [],
      history: [
        { role: 'parent', content: 'first' },
        { role: 'kindly', content: 'reply' },
      ],
      message: 'second',
    });
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
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
