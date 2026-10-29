import type { Querier } from '../querier';
import {
  type Parent,
  type Relationship,
  PARENT_LANGUAGES,
  PARENT_SHORT_FIELD_MAX,
  SPEECH_RATES,
  NotFoundError,
  PreconditionError,
  ValidationError,
} from '../types';

/** Optional short text (pronouns, city): trimmed, empty → null, capped. */
function shortText(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text`);
  const t = value.trim();
  if (t.length > PARENT_SHORT_FIELD_MAX) {
    throw new ValidationError(`${field} must be ${PARENT_SHORT_FIELD_MAX} characters or fewer`);
  }
  return t || null;
}

function checkEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (!allowed.includes(value as T)) throw new ValidationError(`${field} is invalid`);
  return value as T;
}

function checkBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new ValidationError(`${field} must be true or false`);
  return value;
}

/**
 * Validate the profile fields a buyer can set. These values reach the
 * companion's prompt (pronouns, city) and the speech providers (language,
 * speech_rate), so they are capped and allow-listed on every write.
 */
export function validateParentFields(input: {
  pronouns?: unknown;
  city?: unknown;
  language?: unknown;
  speechRate?: unknown;
  largeText?: unknown;
  voiceFirst?: unknown;
}) {
  return {
    pronouns: shortText(input.pronouns, 'pronouns'),
    city: shortText(input.city, 'city'),
    language: checkEnum(input.language, PARENT_LANGUAGES, 'language'),
    speechRate: checkEnum(input.speechRate, SPEECH_RATES, 'speech_rate'),
    largeText: checkBool(input.largeText, 'large_text'),
    voiceFirst: checkBool(input.voiceFirst, 'voice_first'),
  };
}
import { consentRepo } from './consent';
import { billingCancellation } from '../billing/cancel';

const RELATIONSHIPS: Relationship[] = ['mother', 'father', 'grandparent', 'aunt', 'uncle', 'other', 'self'];

export interface CreateParentInput {
  buyerId: string;
  firstName: string;
  pronouns?: string | null;
  relationship: Relationship;
  city?: string | null;
  language?: string;
  largeText?: boolean;
  voiceFirst?: boolean;
  speechRate?: 'slow' | 'normal';
}

export const parentRepo = {
  async create(q: Querier, input: CreateParentInput): Promise<Parent> {
    const firstName = (input.firstName ?? '').trim();
    if (!firstName) throw new ValidationError('firstName is required');
    if (firstName.length > 80) throw new ValidationError('firstName is too long');
    const fields = validateParentFields(input);
    if (!RELATIONSHIPS.includes(input.relationship)) {
      throw new ValidationError('relationship is invalid');
    }
    if (!input.buyerId) throw new ValidationError('buyerId is required');

    const { rows } = await q.query<Parent>(
      `INSERT INTO parents
         (buyer_id, first_name, pronouns, relationship, city, language,
          large_text, voice_first, speech_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        input.buyerId,
        firstName,
        fields.pronouns ?? null,
        input.relationship,
        fields.city ?? null,
        fields.language ?? 'en-US',
        fields.largeText ?? true,
        fields.voiceFirst ?? true,
        fields.speechRate ?? 'slow',
      ],
    );
    return rows[0];
  },

  /**
   * Fetch a parent, scoped to the owning buyer. ISOLATION RULE: if the parent
   * exists but belongs to someone else (or doesn't exist), we throw NotFound —
   * never reveal another tenant's data, and never distinguish 403 from 404.
   */
  async getOwned(q: Querier, parentId: string, buyerId: string): Promise<Parent> {
    const { rows } = await q.query<Parent>(
      `SELECT * FROM parents
       WHERE id = $1 AND buyer_id = $2 AND deleted_at IS NULL`,
      [parentId, buyerId],
    );
    if (rows.length === 0) throw new NotFoundError('Parent not found');
    return rows[0];
  },

  /**
   * List a buyer's parents (non-deleted), newest first. Scoped to the owning
   * buyer — never returns another tenant's parents.
   */
  async listForBuyer(q: Querier, buyerId: string): Promise<Parent[]> {
    const { rows } = await q.query<Parent>(
      `SELECT * FROM parents
       WHERE buyer_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [buyerId],
    );
    return rows;
  },

  /**
   * Fetch a parent by id alone — for parent-authenticated talk routes, where the
   * caller is the parent (resolved from an access token), not the owning buyer.
   */
  async getById(q: Querier, parentId: string): Promise<Parent> {
    const { rows } = await q.query<Parent>(
      `SELECT * FROM parents WHERE id = $1 AND deleted_at IS NULL`,
      [parentId],
    );
    if (rows.length === 0) throw new NotFoundError('Parent not found');
    return rows[0];
  },

  async update(
    q: Querier,
    parentId: string,
    buyerId: string,
    patch: Partial<Pick<Parent, 'pronouns' | 'city' | 'language' | 'large_text' | 'voice_first' | 'speech_rate'>>,
  ): Promise<Parent> {
    await parentRepo.getOwned(q, parentId, buyerId); // enforces isolation
    const f = validateParentFields({
      pronouns: patch.pronouns,
      city: patch.city,
      language: patch.language,
      speechRate: patch.speech_rate,
      largeText: patch.large_text,
      voiceFirst: patch.voice_first,
    });
    const { rows } = await q.query<Parent>(
      `UPDATE parents SET
         pronouns    = COALESCE($3, pronouns),
         city        = COALESCE($4, city),
         language    = COALESCE($5, language),
         large_text  = COALESCE($6, large_text),
         voice_first = COALESCE($7, voice_first),
         speech_rate = COALESCE($8, speech_rate)
       WHERE id = $1 AND buyer_id = $2
       RETURNING *`,
      [
        parentId,
        buyerId,
        f.pronouns ?? null,
        f.city ?? null,
        f.language ?? null,
        f.largeText ?? null,
        f.voiceFirst ?? null,
        f.speechRate ?? null,
      ],
    );
    return rows[0];
  },

  /**
   * Activation gate: a parent can only be activated once the buyer has
   * attested they have the parent's permission. Without that consent we
   * refuse with a PreconditionError (API → 409).
   */
  async activate(q: Querier, parentId: string, buyerId: string): Promise<Parent> {
    const parent = await parentRepo.getOwned(q, parentId, buyerId);
    if (parent.activated_at) return parent; // idempotent

    const hasAttestation = await consentRepo.has(q, parentId, 'buyer_attestation');
    if (!hasAttestation) {
      throw new PreconditionError(
        'Buyer attestation of parent permission is required before activation.',
      );
    }
    const { rows } = await q.query<Parent>(
      `UPDATE parents SET activated_at = now()
       WHERE id = $1 AND buyer_id = $2
       RETURNING *`,
      [parentId, buyerId],
    );
    return rows[0];
  },

  /** Soft-delete; a daily job hard-deletes within the retention window. */
  /**
   * Delete one parent profile: cancel its subscription (Stripe first; throws
   * BillingUnavailableError and deletes nothing if Stripe can't be reached),
   * revoke its talk links, then soft-delete (hard purge after 30 days).
   * Idempotent: safe to retry.
   */
  async softDelete(q: Querier, parentId: string, buyerId: string): Promise<void> {
    await parentRepo.getOwned(q, parentId, buyerId);
    await billingCancellation.cancelForParent(q, parentId);
    await q.query(
      `UPDATE parent_access_tokens SET revoked_at = now() WHERE parent_id = $1 AND revoked_at IS NULL`,
      [parentId],
    );
    await q.query(
      `UPDATE parents SET deleted_at = now() WHERE id = $1 AND buyer_id = $2`,
      [parentId, buyerId],
    );
  },
};
