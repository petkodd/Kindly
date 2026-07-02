/**
 * AI provider abstraction — the seam between Kindly and the companion model.
 *
 * Per docs/prompt_architecture_v1.md there are exactly four model operations
 * behind this layer. Everything that talks to the model (talk turns, session-end
 * jobs, safety scan) goes through an `AiClient`, so callers never import the SDK
 * directly and tests run against a deterministic fake.
 */

import type { MemoryLayer, Sensitivity } from '../types';

/** Coarse, non-clinical mood signal stored on a conversation. */
export type MoodSignal = 'warm' | 'flat' | 'low';

/** Safety pre-scan severity (maps to flag_severity_t / null when clear). */
export type SafetySeverity = 'none' | 'p0' | 'p1' | 'p2' | 'p3';

/** A single confirmed memory injected into the companion context. */
export interface RetrievedMemory {
  layer: MemoryLayer;
  key: string;
  value: string;
}

/** Minimal parent context the companion needs to personalize a reply. */
export interface CompanionProfile {
  firstName: string;
  pronouns?: string | null;
  city?: string | null;
  speechRate?: 'slow' | 'normal';
}

/** One prior turn in the rolling conversation window. */
export interface ConversationTurn {
  role: 'parent' | 'kindly';
  content: string;
}

export interface CompanionReplyInput {
  profile: CompanionProfile;
  /** Top-K confirmed, non-restricted memories (retrieval is the caller's job). */
  memories: RetrievedMemory[];
  /** Recent turns, oldest first, already trimmed to the token budget. */
  history: ConversationTurn[];
  /** The parent's latest message. */
  message: string;
  /** True on the first turn of a session → reply opens with AI-identity disclosure. */
  isSessionOpen?: boolean;
}

export interface CompanionReply {
  text: string;
}

export interface SafetyScanInput {
  message: string;
}

export interface SafetyScan {
  severity: SafetySeverity;
  rationale: string;
}

export interface MemoryExtractionInput {
  /** Recent turns to mine for durable facts. */
  turns: ConversationTurn[];
}

export interface MemoryCandidate {
  layer: Extract<MemoryLayer, 'core' | 'interest' | 'episodic'>;
  key: string;
  value: string;
  sensitivity: Sensitivity;
  /** 0..1; callers discard low-confidence candidates. */
  confidence: number;
}

export interface ConversationSummaryInput {
  firstName: string;
  turns: ConversationTurn[];
}

export interface ConversationSummary {
  /** 2–4 warm, non-clinical sentences. Safe to share with family. */
  summaryText: string;
  /** Coarse mood; null when there isn't a clear signal. */
  moodSignal: MoodSignal | null;
}

/**
 * The four operations. Implementations: `anthropicAiClient` (real, SDK-backed)
 * and `fakeAiClient` (deterministic, for tests + local dev without a key).
 */
export interface AiClient {
  /** (2) Companion reply for a parent turn. */
  companionReply(input: CompanionReplyInput): Promise<CompanionReply>;
  /** (1) Lightweight safety pre-scan run on each parent turn. */
  safetyScan(input: SafetyScanInput): Promise<SafetyScan>;
  /** (3) Async post-turn extraction of candidate memories. */
  extractMemories(input: MemoryExtractionInput): Promise<MemoryCandidate[]>;
  /** (4) Session-end conversation summary + mood signal. */
  summarizeConversation(input: ConversationSummaryInput): Promise<ConversationSummary>;
}
