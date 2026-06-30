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
