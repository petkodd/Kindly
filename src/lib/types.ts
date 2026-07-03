/**
 * Domain types mirror db/migrations/0001_init.sql.
 * Keep these in sync with the schema when it evolves.
 */

export type Relationship = 'mother' | 'father' | 'grandparent' | 'aunt' | 'uncle' | 'other';

export type MemoryLayer = 'profile' | 'core' | 'interest' | 'episodic' | 'sensitive';
export type MemorySource = 'onboarding' | 'conversation' | 'family';
export type MemoryStatus = 'proposed' | 'confirmed' | 'retired';
export type Sensitivity = 'normal' | 'sensitive' | 'restricted';

export type ConsentKind = 'buyer_attestation' | 'parent_conversation' | 'summary_recipient';

export type SummaryStatus = 'draft' | 'preview' | 'sent';
export type DeliveryChannel = 'email' | 'sms';

export interface Parent {
  id: string;
  buyer_id: string;
  first_name: string;
  pronouns: string | null;
  relationship: Relationship;
  city: string | null;
  language: string;
  large_text: boolean;
  voice_first: boolean;
  speech_rate: 'slow' | 'normal';
  created_at: string;
  activated_at: string | null;
  deleted_at: string | null;
}

export interface Memory {
  id: string;
  parent_id: string;
  layer: MemoryLayer;
  mem_key: string;
  mem_value: string;
  source: MemorySource;
  status: MemoryStatus;
  sensitivity: Sensitivity;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  decay_at: string | null;
}

export interface Consent {
  id: string;
  parent_id: string;
  kind: ConsentKind;
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
  detail: Record<string, unknown> | null;
}

export interface WeeklySummary {
  id: string;
  parent_id: string;
  period_start: string;
  period_end: string;
  status: SummaryStatus;
  body_long: string | null;
  body_short: string | null;
  has_concern: boolean;
  generated_at: string;
}

export interface SummaryDelivery {
  id: string;
  summary_id: string;
  recipient_user: string | null;
  channel: DeliveryChannel;
  consent_id: string;
  sent_at: string | null;
  status: string;
}

export type ConversationChannel = 'voice' | 'text';
export type TurnRole = 'parent' | 'kindly';

export type FlagSeverity = 'p0_crisis' | 'p1_acute_medical' | 'p2_welfare' | 'p3_abuse';
export type FlagStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

export interface SafetyFlag {
  id: string;
  parent_id: string;
  conversation_id: string | null;
  severity: FlagSeverity;
  status: FlagStatus;
  detail: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface Conversation {
  id: string;
  parent_id: string;
  started_at: string;
  ended_at: string | null;
  channel: ConversationChannel;
  voice_minutes: string;
  summary_text: string | null;
  mood_signal: string | null;
  memories_extracted_at: string | null;
}

export interface ConversationTurnRecord {
  id: string;
  conversation_id: string;
  role: TurnRole;
  content: string;
  created_at: string;
  retention_purge_at: string | null;
}

/** Thrown when a caller tries to reach a parent they don't own. API maps this to 404. */
export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Thrown when an action is blocked by a missing precondition (e.g. consent). API maps to 409. */
export class PreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreconditionError';
  }
}

/** Thrown on invalid input. API maps to 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Thrown when a consent/authorization gate blocks an action. API maps to 403. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}
