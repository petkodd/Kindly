import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
  },
}));

import { createAnthropicAiClient } from '../src/lib/ai/anthropic';
import {
  COMPANION_SYSTEM_V2,
  DEFAULT_SAFETY_MODEL_V2,
  DEFAULT_COMPANION_MODEL_V2,
} from '../src/lib/ai/prompts';

const textMsg = (text: string) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });

beforeEach(() => create.mockReset());

describe('Anthropic client — V2 request shape', () => {
  it('companion reply: V2 system + context, max_tokens 250, the companion model', async () => {
    create.mockResolvedValueOnce(textMsg('Hello Ruth.'));
    const ai = createAnthropicAiClient('test-key');
    await ai.companionReply({
      profile: { firstName: 'Ruth' },
      memories: [],
      history: [],
      message: 'hi',
      alertContactFirstName: 'Sarah',
    });
    const req = create.mock.calls[0][0];
    expect(req.max_tokens).toBe(250);
    expect(req.model).toBe(process.env.AI_MODEL || DEFAULT_COMPANION_MODEL_V2);
    expect(req.system.startsWith(COMPANION_SYSTEM_V2)).toBe(true);
    expect(req.system).toMatch(/ALERT CONTACT: Sarah/);
  });

  it('safety scan: the small safety model, max_tokens 150, history in <conversation> tags', async () => {
    create.mockResolvedValueOnce(textMsg('{"severity":"p1","rationale":"possible fall"}'));
    const ai = createAnthropicAiClient('test-key');
    const scan = await ai.safetyScan({
      message: 'I fell',
      history: [{ role: 'parent', content: 'I was in the garden' }],
    });
    expect(scan.severity).toBe('p1');
    const req = create.mock.calls[0][0];
    expect(req.model).toBe(process.env.AI_SAFETY_MODEL || DEFAULT_SAFETY_MODEL_V2);
    expect(req.max_tokens).toBe(150);
    expect(req.messages[0].content).toMatch(/<conversation>\nperson: I was in the garden\n<\/conversation>/);
    expect(req.messages[0].content).toMatch(/<message>\nI fell\n<\/message>/);
  });
});
