import type {
  AiClient,
  CompanionReply,
  CompanionReplyInput,
  ConversationSummary,
  ConversationSummaryInput,
  MemoryCandidate,
  MemoryExtractionInput,
  MoodSignal,
  SafetyScan,
  SafetyScanInput,
  SafetySeverity,
} from './types';

/**
 * Deterministic, offline stand-in for the companion model. Used by tests and by
 * local dev when AI_API_KEY is unset. It is intentionally rule-based (no
 * randomness) so downstream slices — talk, safety, session-end jobs — can be
 * tested without a live model, and it honors the same contracts the real client
 * must: AI-identity disclosure on session open, keyword-tiered safety, restricted
 * sensitivity for health/mood, non-clinical summaries.
 *
 * It is NOT a quality reference for prompt behavior — only for shape + contract.
 */

const AI_DISCLOSURE = "Hello, I'm Kindly — an AI companion, here to chat with you.";

// Keyword tiers for the safety pre-scan. Highest severity that matches wins.
const SAFETY_RULES: { severity: Exclude<SafetySeverity, 'none'>; terms: RegExp }[] = [
  { severity: 'p0', terms: /\b(kill myself|suicide|end my life|don'?t want to live)\b/i },
  { severity: 'p1', terms: /\b(chest pain|can'?t breathe|i fell|fell down|stroke)\b/i },
  { severity: 'p2', terms: /\b(hopeless|not eating|haven'?t eaten|so alone|confused)\b/i },
  { severity: 'p3', terms: /\b(hitting me|took my money|scam|threatened)\b/i },
];

const LOW_MOOD = /\b(sad|lonely|down|miss|tired|hopeless)\b/i;
const WARM_MOOD = /\b(happy|glad|wonderful|love|good|great|thank)\b/i;

export const fakeAiClient: AiClient = {
  async companionReply(input: CompanionReplyInput): Promise<CompanionReply> {
    const parts: string[] = [];
    if (input.isSessionOpen) parts.push(AI_DISCLOSURE);
    parts.push(`It's good to talk with you, ${input.profile.firstName}.`);
    const memory = input.memories[0];
    if (memory) parts.push(`I remember you mentioned ${memory.value}.`);
    parts.push('What would you like to talk about today?');
    return { text: parts.join(' ') };
  },

  async safetyScan({ message }: SafetyScanInput): Promise<SafetyScan> {
    for (const rule of SAFETY_RULES) {
      if (rule.terms.test(message)) {
        return { severity: rule.severity, rationale: `matched ${rule.severity} keywords` };
      }
    }
    return { severity: 'none', rationale: 'no safety concern detected' };
  },

  async extractMemories({ turns }: MemoryExtractionInput): Promise<MemoryCandidate[]> {
    const candidates: MemoryCandidate[] = [];
    for (const turn of turns) {
      if (turn.role !== 'parent') continue;
      const like = turn.content.match(/\bI (?:like|love|enjoy) ([^.!?]+)/i);
      if (like) {
        candidates.push({
          layer: 'interest',
          key: 'likes',
          value: like[1].trim(),
          sensitivity: 'normal',
          confidence: 0.8,
        });
      }
      if (LOW_MOOD.test(turn.content)) {
        candidates.push({
          layer: 'episodic',
          key: 'mood_moment',
          value: turn.content.trim(),
          sensitivity: 'restricted',
          confidence: 0.6,
        });
      }
    }
    return candidates;
  },

  async summarizeConversation({
    firstName,
    turns,
  }: ConversationSummaryInput): Promise<ConversationSummary> {
    const parentTurns = turns.filter((t) => t.role === 'parent');
    const text = parentTurns.map((t) => t.content).join(' ');

    let moodSignal: MoodSignal | null = null;
    if (LOW_MOOD.test(text)) moodSignal = 'low';
    else if (WARM_MOOD.test(text)) moodSignal = 'warm';
    else if (parentTurns.length > 0) moodSignal = 'flat';

    const summaryText =
      parentTurns.length === 0
        ? `${firstName} didn't say much this time.`
        : `${firstName} had a ${parentTurns.length}-turn chat with Kindly. It was a gentle conversation.`;

    return { summaryText, moodSignal };
  },
};
