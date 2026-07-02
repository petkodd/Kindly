import Anthropic from '@anthropic-ai/sdk';
import type { Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type {
  AiClient,
  CompanionReply,
  CompanionReplyInput,
  ConversationSummary,
  ConversationSummaryInput,
  MemoryCandidate,
  MemoryExtractionInput,
  SafetyScan,
  SafetyScanInput,
} from './types';
import { AiError } from './types';
import {
  COMPANION_SYSTEM_V1,
  CONVERSATION_SUMMARY_SYSTEM_V1,
  MEMORY_EXTRACTION_SYSTEM_V1,
  SAFETY_SCAN_SYSTEM_V1,
} from './prompts';

/**
 * Real companion model, backed by the official Anthropic SDK. Constructed by
 * `getAiClient()` only when AI_API_KEY is set; otherwise the fake is used. The
 * model id comes from AI_MODEL (see .env.example — the project pins
 * claude-sonnet-4-6), defaulting to the latest Opus when unset.
 *
 * The three JSON operations use structured outputs (`output_config.format`) so
 * the model's reply is schema-constrained and safe to JSON.parse. The companion
 * reply is plain text and does not use thinking — talk latency is user-facing.
 */

const MODEL = process.env.AI_MODEL || 'claude-opus-4-8';

function textOf(message: Message): string {
  return message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/**
 * Pull usable text off a response, or throw AiError. A refusal or an empty body
 * is a failure the caller must handle, not an empty string to parse. `where`
 * names the operation for the error message. Exported for unit testing.
 */
export function requireText(message: Message, where: string): string {
  if (message.stop_reason === 'refusal') {
    throw new AiError(`${where}: model refused the request`);
  }
  const text = textOf(message);
  if (!text) throw new AiError(`${where}: model returned no text`);
  return text;
}

/** Parse a response body as JSON, or throw AiError. Exported for unit testing. */
export function parseJson<T>(message: Message, where: string): T {
  const text = requireText(message, where);
  try {
    return JSON.parse(text) as T;
  } catch {
    // Most often a max_tokens truncation left the JSON incomplete.
    const truncated = message.stop_reason === 'max_tokens' ? ' (response was truncated)' : '';
    throw new AiError(`${where}: could not parse model output as JSON${truncated}`);
  }
}

/** Render the personalization layers into a single system suffix. */
function renderContext(input: CompanionReplyInput): string {
  const lines: string[] = [];
  const p = input.profile;
  const profileBits = [
    `first name: ${p.firstName}`,
    p.pronouns ? `pronouns: ${p.pronouns}` : null,
    p.city ? `city: ${p.city}` : null,
    p.speechRate ? `speech: ${p.speechRate}` : null,
  ].filter(Boolean);
  lines.push(`PARENT PROFILE — ${profileBits.join(', ')}.`);
  if (input.memories.length > 0) {
    lines.push('CONFIRMED MEMORIES (never restricted):');
    for (const m of input.memories) lines.push(`- [${m.layer}] ${m.key}: ${m.value}`);
  }
  if (input.isSessionOpen) {
    lines.push('This is the first turn of the session — open by disclosing you are an AI companion.');
  }
  return lines.join('\n');
}

export function createAnthropicAiClient(apiKey: string): AiClient {
  const client = new Anthropic({ apiKey });

  async function jsonCall<T>(
    where: string,
    system: string,
    userText: string,
    schema: Record<string, unknown>,
    maxTokens: number,
  ): Promise<T> {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userText }],
      output_config: { format: { type: 'json_schema', schema } },
    });
    return parseJson<T>(message, where);
  }

  return {
    async companionReply(input: CompanionReplyInput): Promise<CompanionReply> {
      const history: MessageParam[] = input.history.map((t) => ({
        role: t.role === 'parent' ? 'user' : 'assistant',
        content: t.content,
      }));
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: `${COMPANION_SYSTEM_V1}\n\n${renderContext(input)}`,
        messages: [...history, { role: 'user', content: input.message }],
      });
      return { text: requireText(message, 'companionReply') };
    },

    async safetyScan({ message }: SafetyScanInput): Promise<SafetyScan> {
      return jsonCall<SafetyScan>(
        'safetyScan',
        SAFETY_SCAN_SYSTEM_V1,
        message,
        {
          type: 'object',
          additionalProperties: false,
          required: ['severity', 'rationale'],
          properties: {
            severity: { type: 'string', enum: ['none', 'p0', 'p1', 'p2', 'p3'] },
            rationale: { type: 'string' },
          },
        },
        1024,
      );
    },

    async extractMemories({ turns }: MemoryExtractionInput): Promise<MemoryCandidate[]> {
      const transcript = turns.map((t) => `${t.role}: ${t.content}`).join('\n');
      const { candidates } = await jsonCall<{ candidates: MemoryCandidate[] }>(
        'extractMemories',
        MEMORY_EXTRACTION_SYSTEM_V1,
        transcript,
        {
          type: 'object',
          additionalProperties: false,
          required: ['candidates'],
          properties: {
            candidates: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['layer', 'key', 'value', 'sensitivity', 'confidence'],
                properties: {
                  layer: { type: 'string', enum: ['core', 'interest', 'episodic'] },
                  key: { type: 'string' },
                  value: { type: 'string' },
                  sensitivity: { type: 'string', enum: ['normal', 'sensitive', 'restricted'] },
                  confidence: { type: 'number' },
                },
              },
            },
          },
        },
        // Scales with transcript length — more headroom than the short ops.
        4096,
      );
      return candidates;
    },

    async summarizeConversation({
      firstName,
      turns,
    }: ConversationSummaryInput): Promise<ConversationSummary> {
      const transcript = `Parent's first name: ${firstName}\n\n${turns
        .map((t) => `${t.role}: ${t.content}`)
        .join('\n')}`;
      return jsonCall<ConversationSummary>(
        'summarizeConversation',
        CONVERSATION_SUMMARY_SYSTEM_V1,
        transcript,
        {
          type: 'object',
          additionalProperties: false,
          required: ['summaryText', 'moodSignal'],
          properties: {
            summaryText: { type: 'string' },
            moodSignal: {
              anyOf: [{ type: 'string', enum: ['warm', 'flat', 'low'] }, { type: 'null' }],
            },
          },
        },
        1024,
      );
    },
  };
}
