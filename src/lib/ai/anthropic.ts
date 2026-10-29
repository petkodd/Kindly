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
  COMPANION_MAX_TOKENS_V2,
  COMPANION_SYSTEM_V2,
  CONVERSATION_SUMMARY_SYSTEM_V1,
  DEFAULT_COMPANION_MODEL_V2,
  DEFAULT_SAFETY_MODEL_V2,
  MEMORY_EXTRACTION_SYSTEM_V2,
  SAFETY_SCAN_MAX_TOKENS_V2,
  SAFETY_SCAN_SYSTEM_V2,
  renderCompanionContextV2,
  renderSafetyScanInputV2,
} from './prompts';

/**
 * Real companion model, backed by the official Anthropic SDK. Constructed by
 * `getAiClient()` only when AI_API_KEY is set; otherwise the fake is used. The
 * companion model id comes from AI_MODEL and the safety scan's from
 * AI_SAFETY_MODEL (a small, fast model). Both default to the ids in the signed
 * prompt bundle (prompts.ts); an override that differs is warned about once,
 * because it runs a configuration nobody signed off.
 *
 * The three JSON operations use structured outputs (`output_config.format`) so
 * the model's reply is schema-constrained and safe to JSON.parse. The companion
 * reply is plain text and does not use thinking — talk latency is user-facing.
 */

const MODEL = process.env.AI_MODEL || DEFAULT_COMPANION_MODEL_V2;
const SAFETY_MODEL = process.env.AI_SAFETY_MODEL || DEFAULT_SAFETY_MODEL_V2;

function warnIfUnsignedModels(): void {
  if (MODEL !== DEFAULT_COMPANION_MODEL_V2 || SAFETY_MODEL !== DEFAULT_SAFETY_MODEL_V2) {
    console.warn(
      `[ai] running models that differ from the signed defaults (companion ${MODEL}, safety ${SAFETY_MODEL}); ` +
        'update the defaults in prompts.ts and get a new sign-off.',
    );
  }
}

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

/**
 * Assemble the Messages API `messages` array for a companion turn. The Messages
 * API requires the first message to be from the user, but the session-open
 * greeting is stored as a `kindly` turn — so on the first parent message the
 * history starts with an assistant turn. Drop any leading assistant turns (they
 * carry no user context to alternate against) so the request never 400s.
 * Exported for unit testing without the SDK/network.
 */
export function buildCompanionMessages(input: CompanionReplyInput): MessageParam[] {
  const history: MessageParam[] = input.history.map((t) => ({
    role: t.role === 'parent' ? 'user' : 'assistant',
    content: t.content,
  }));
  while (history.length > 0 && history[0].role === 'assistant') history.shift();
  return [...history, { role: 'user', content: input.message }];
}

export function createAnthropicAiClient(apiKey: string): AiClient {
  const client = new Anthropic({ apiKey });
  warnIfUnsignedModels();

  async function jsonCall<T>(
    where: string,
    system: string,
    userText: string,
    schema: Record<string, unknown>,
    maxTokens: number,
    model: string = MODEL,
  ): Promise<T> {
    const message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userText }],
      output_config: { format: { type: 'json_schema', schema } },
    });
    return parseJson<T>(message, where);
  }

  return {
    async companionReply(input: CompanionReplyInput): Promise<CompanionReply> {
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: COMPANION_MAX_TOKENS_V2,
        system: `${COMPANION_SYSTEM_V2}\n\n${renderCompanionContextV2(input)}`,
        messages: buildCompanionMessages(input),
      });
      return { text: requireText(message, 'companionReply') };
    },

    async safetyScan({ message, history }: SafetyScanInput): Promise<SafetyScan> {
      return jsonCall<SafetyScan>(
        'safetyScan',
        SAFETY_SCAN_SYSTEM_V2,
        renderSafetyScanInputV2({ message, history }),
        {
          type: 'object',
          additionalProperties: false,
          required: ['severity', 'rationale'],
          properties: {
            severity: { type: 'string', enum: ['none', 'p0', 'p1', 'p2', 'p3'] },
            rationale: { type: 'string' },
          },
        },
        SAFETY_SCAN_MAX_TOKENS_V2,
        SAFETY_MODEL,
      );
    },

    async extractMemories({ turns }: MemoryExtractionInput): Promise<MemoryCandidate[]> {
      const transcript = turns.map((t) => `${t.role}: ${t.content}`).join('\n');
      const { candidates } = await jsonCall<{ candidates: MemoryCandidate[] }>(
        'extractMemories',
        MEMORY_EXTRACTION_SYSTEM_V2,
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
