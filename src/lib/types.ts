/**
 * Domain types mirror db/migrations/0001_init.sql.
 * Keep these in sync with the schema when it evolves.
 */

export type Relationship = 'mother' | 'father' | 'grandparent' | 'aunt' | 'uncle' | 'other' | 'self';

export type MemoryLayer = 'profile' | 'core' | 'interest' | 'episodic' | 'sensitive';
export type MemorySource = 'onboarding' | 'conversation' | 'family';
export type MemoryStatus = 'proposed' | 'confirmed' | 'retired';
export type Sensitivity = 'normal' | 'sensitive' | 'restricted';

/** Layers a buyer may write to. */
export const MEMORY_LAYERS: MemoryLayer[] = ['profile', 'core', 'interest', 'episodic', 'sensitive'];
/**
 * Sensitivities a memory may be STORED with. 'restricted' (health, mood, risk)
 * is never stored as a memory (decision D6): it stays a safety signal only.
 */
export const STORABLE_SENSITIVITIES: Exclude<Sensitivity, 'restricted'>[] = ['normal', 'sensitive'];
/** Server caps, shared with the UI (chat 12 shows them on the form). */
export const MEMORY_KEY_MAX = 64;
export const MEMORY_VALUE_MAX = 300;
/** Episodic memories fade after this long (they are time-bound by definition). */
export const EPISODIC_DECAY_DAYS = 30;

/** Talk languages the app supports (speech-to-text + profile picker). */
export const PARENT_LANGUAGES = ['en-US', 'en-GB', 'es-US', 'fr-FR', 'de-DE'] as const;
export const SPEECH_RATES = ['slow', 'normal'] as const;
export const PARENT_SHORT_FIELD_MAX = 40;

export type ConsentKind = 'buyer_attestation' | 'parent_conversation' | 'summary_recipient';

export type SummaryStatus = 'draft' | 'preview' | 'sent';
export type DeliveryChannel = 'email' | 'sms';

export type Plan = 'founding' | 'family' | 'premium' | 'gift_3mo' | 'trial';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'beta';

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
  /** 'pending' | 'sent' | 'simulated' (fake email client, nothing sent) | 'failed' */
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
  /** When a family alert went out for this flag (decision D2); null if none did. */
  notified_at: string | null;
  /** Per-channel alert delivery status — see db/migrations/0014_safety_alerts.sql. */
  alert_email_status: AlertDeliveryStatus | null;
  alert_sms_status: AlertDeliveryStatus | null;
  alert_admin_status: AlertDeliveryStatus | null;
}

export type AlertDeliveryStatus =
  | 'sent'
  | 'failed'
  | 'skipped_no_phone'
  | 'skipped_no_consent'
  | 'suppressed_rate_limit'
  | 'not_configured'
  /** Went through a fake (dev/demo) client: nothing reached a real inbox or phone. */
  | 'simulated';

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

export interface Subscription {
  id: string;
  buyer_id: string;
  parent_id: string | null;
  plan: Plan;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_sub_id: string | null;
  current_period_end: string | null;
  created_at: string;
  /** NULL for rows created before annual billing shipped — treat as 'month'. */
  billing_interval: 'month' | 'year' | null;
  /** Set only for status = 'beta' — the beta_invites row this entitlement was granted from. */
  beta_invite_id: string | null;
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

/**
 * Thrown specifically when a lapsed/missing subscription blocks an action.
 * API maps to 402 — deliberately distinct from ForbiddenError (403) so a
 * client can tell "go start/renew a trial" apart from "not activated" or
 * "consent missing" without parsing the message string.
 */
export class PaymentRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentRequiredError';
  }
}

/** Thrown when a unique resource already exists (e.g. duplicate email). API maps to 409. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** A required upstream (e.g. Stripe) can't be reached or isn't configured. API maps to 503. */
export class BillingUnavailableError extends Error {
  constructor(message = 'We couldn’t reach our billing provider. Nothing was deleted. Please try again in a few minutes.') {
    super(message);
    this.name = 'BillingUnavailableError';
  }
}

/** The account's email isn't confirmed yet, so this action (inviting family, sending summaries) is held. API: 403 email_unverified. */
export class EmailNotVerifiedError extends Error {
  constructor(
    message = 'Please confirm your email address first. We sent you a link when you signed up — you can resend it from your account page.',
  ) {
    super(message);
    this.name = 'EmailNotVerifiedError';
  }
}

/** A one-time link (e.g. a summary invite) is valid but too old. API maps to 410. */
export class ExpiredError extends Error {
  constructor(message = 'This link has expired.') {
    super(message);
    this.name = 'ExpiredError';
  }
}

/** Thrown when an upload or message is over its size cap. API maps to 413. */
export class PayloadTooLargeError extends Error {
  constructor(message = 'That was too long.') {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

/** Thrown when a conversation has reached its turn cap and was ended. API maps to 409 conversation_full. */
export class ConversationFullError extends Error {
  constructor(message = 'We’ve had a long chat. Let’s start a fresh conversation.') {
    super(message);
    this.name = 'ConversationFullError';
  }
}

/** Thrown when a caller exceeds a rate limit. API maps to 429. */
export class RateLimitError extends Error {
  /** API error code; 'rate_limited' unless a more specific one helps the client (e.g. 'voice_limit'). */
  code: string;
  constructor(message = 'Too many requests. Please try again later.', code = 'rate_limited') {
    super(message);
    this.name = 'RateLimitError';
    this.code = code;
  }
}
