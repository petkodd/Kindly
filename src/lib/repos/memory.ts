import type { Querier } from '../querier';
import {
  type Memory,
  type MemoryLayer,
  type MemorySource,
  type MemoryStatus,
  type Sensitivity,
  MEMORY_KEY_MAX,
  MEMORY_LAYERS,
  MEMORY_VALUE_MAX,
  STORABLE_SENSITIVITIES,
  ValidationError,
  PreconditionError,
  NotFoundError,
} from '../types';

const STATUSES: MemoryStatus[] = ['proposed', 'confirmed', 'retired'];

/**
 * Code-level backstop for memories proposed from conversation: the extraction
 * prompt says never to extract credentials or account numbers, and this
 * catches the obvious misses (a PIN, password, SSN-shaped or card-shaped
 * number) so they never reach the buyer's review list. Deliberately narrow:
 * an ordinary year ("passed in 2019") is fine.
 */
const SECRET_WORDS = /\b(pin|pins|password|passcode|passwords|account number|routing number|card number|cvv|ssn|social security)\b/i;
const SSN_SHAPE = /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/;
const CARD_SHAPE = /\b(?:\d[ -]?){13,19}\b/;
export function containsSecretDetail(text: string): boolean {
  return SECRET_WORDS.test(text) || SSN_SHAPE.test(text) || CARD_SHAPE.test(text);
}

/** Trim and enforce the server caps on a key/value pair. */
export function cleanMemoryText(keyIn: unknown, valueIn: unknown): { key: string; value: string } {
  const key = typeof keyIn === 'string' ? keyIn.trim() : '';
  const value = typeof valueIn === 'string' ? valueIn.trim() : '';
  if (!key) throw new ValidationError('memory key is required');
  if (!value) throw new ValidationError('memory value is required');
  if (key.length > MEMORY_KEY_MAX) throw new ValidationError(`memory key must be ${MEMORY_KEY_MAX} characters or fewer`);
  if (value.length > MEMORY_VALUE_MAX) {
    throw new ValidationError(`memory value must be ${MEMORY_VALUE_MAX} characters or fewer`);
  }
  return { key, value };
}

export interface AddMemoryInput {
  parentId: string;
  layer: MemoryLayer;
  key: string;
  value: string;
  source: MemorySource;
  sensitivity?: Sensitivity;
  createdBy?: string | null;
  decayAt?: string | null;
}

export const memoryRepo = {
  /**
   * Add a memory. Approval semantics:
   *  - onboarding (buyer-seeded) → status 'confirmed'
   *  - family-provided           → status 'confirmed'
   *  - conversation-proposed      → status 'proposed' (awaits confirmation)
   */
  async add(q: Querier, input: AddMemoryInput): Promise<Memory> {
    const { key, value } = cleanMemoryText(input.key, input.value);
    if (!MEMORY_LAYERS.includes(input.layer)) throw new ValidationError('memory layer is invalid');
    const sensitivity = input.sensitivity ?? 'normal';
    // Decision D6: health, mood and risk details are never stored as memories.
    if (!(STORABLE_SENSITIVITIES as Sensitivity[]).includes(sensitivity)) {
      throw new ValidationError('memory sensitivity is invalid');
    }

    const status = input.source === 'conversation' ? 'proposed' : 'confirmed';
    const { rows } = await q.query<Memory>(
      `INSERT INTO memories
         (parent_id, layer, mem_key, mem_value, source, status, sensitivity, created_by, decay_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        input.parentId,
        input.layer,
        key,
        value,
        input.source,
        status,
        sensitivity,
        input.createdBy ?? null,
        input.decayAt ?? null,
      ],
    );
    return rows[0];
  },

  /**
   * Memories the buyer (family) reviews on the Memories page: every status, so
   * proposed ones can be confirmed. HARD RULE (decision D6): restricted rows
   * are NEVER returned, to family or anyone else, by this or any other
   * buyer-facing read. Unknown layer/status filters are rejected.
   */
  async list(
    q: Querier,
    parentId: string,
    opts: { layer?: string; status?: string } = {},
  ): Promise<Memory[]> {
    if (opts.layer && !MEMORY_LAYERS.includes(opts.layer as MemoryLayer)) {
      throw new ValidationError('memory layer is invalid');
    }
    if (opts.status && !STATUSES.includes(opts.status as MemoryStatus)) {
      throw new ValidationError('memory status is invalid');
    }
    const clauses = ['parent_id = $1', "sensitivity <> 'restricted'"];
    const params: unknown[] = [parentId];
    if (opts.layer) {
      params.push(opts.layer);
      clauses.push(`layer = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      clauses.push(`status = $${params.length}`);
    }
    const { rows } = await q.query<Memory>(
      `SELECT * FROM memories WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC`,
      params,
    );
    return rows;
  },

  /**
   * Memories safe to surface to family (summaries, dashboard).
   * HARD RULE: restricted-sensitivity memories are NEVER returned here.
   */
  async listForFamily(q: Querier, parentId: string): Promise<Memory[]> {
    const { rows } = await q.query<Memory>(
      `SELECT * FROM memories
       WHERE parent_id = $1
         AND status = 'confirmed'
         AND sensitivity <> 'restricted'
       ORDER BY created_at ASC`,
      [parentId],
    );
    return rows;
  },

  /**
   * Memories to inject into the companion context. Same hard rule as the family
   * view — confirmed only, never restricted — plus episodic memories past their
   * decay date are left out. Ordered for recency and capped, since context has
   * a token budget (semantic retrieval via embeddings comes later; recency is
   * the alpha proxy). 'sensitive' rows are included and rendered in their own
   * block with a "never bring this up first" rule (see renderCompanionContextV2).
   */
  async retrieveForCompanion(q: Querier, parentId: string, limit = 12): Promise<Memory[]> {
    const { rows } = await q.query<Memory>(
      `SELECT * FROM memories
       WHERE parent_id = $1
         AND status = 'confirmed'
         AND sensitivity <> 'restricted'
         AND (decay_at IS NULL OR decay_at > now())
       ORDER BY COALESCE(last_used_at, created_at) DESC
       LIMIT $2`,
      [parentId, limit],
    );
    return rows;
  },

  /**
   * Fetch a memory scoped to the owning buyer. ISOLATION RULE (same as
   * parentRepo.getOwned): a memory under another buyer's parent — or under a
   * deleted parent — is NotFound, never distinguishing 403 from 404.
   */
  async getOwned(q: Querier, memoryId: string, buyerId: string): Promise<Memory> {
    const { rows } = await q.query<Memory>(
      `SELECT * FROM memories
       WHERE id = $1
         AND sensitivity <> 'restricted'
         AND parent_id IN (SELECT id FROM parents WHERE buyer_id = $2 AND deleted_at IS NULL)`,
      [memoryId, buyerId],
    );
    if (rows.length === 0) throw new NotFoundError('Memory not found');
    return rows[0];
  },

  /** Confirm a proposed memory (buyer approval). Buyer-scoped for isolation. */
  async confirm(q: Querier, memoryId: string, buyerId: string): Promise<Memory> {
    await memoryRepo.getOwned(q, memoryId, buyerId); // isolation (NotFound if not owned)
    const { rows } = await q.query<Memory>(
      `UPDATE memories SET status = 'confirmed'
       WHERE id = $1 AND status = 'proposed'
       RETURNING *`,
      [memoryId],
    );
    if (rows.length === 0) {
      throw new PreconditionError('Memory is not in a proposed state.');
    }
    return rows[0];
  },

  /**
   * Edit a memory's key and value (owner-checked, same caps as add). Layer,
   * sensitivity, source and status are unchanged, so an edited family memory
   * stays confirmed and an edited proposal still awaits confirmation.
   */
  async edit(
    q: Querier,
    memoryId: string,
    buyerId: string,
    patch: { key?: unknown; value?: unknown },
  ): Promise<Memory> {
    const current = await memoryRepo.getOwned(q, memoryId, buyerId); // isolation
    const { key, value } = cleanMemoryText(patch.key ?? current.mem_key, patch.value ?? current.mem_value);
    const { rows } = await q.query<Memory>(
      `UPDATE memories SET mem_key = $2, mem_value = $3 WHERE id = $1 RETURNING *`,
      [memoryId, key, value],
    );
    return rows[0];
  },

  async retire(q: Querier, memoryId: string, buyerId: string): Promise<void> {
    await memoryRepo.getOwned(q, memoryId, buyerId); // isolation
    await q.query(`UPDATE memories SET status = 'retired' WHERE id = $1`, [memoryId]);
  },

  /** Hard-delete a memory (honors the user's delete request). Buyer-scoped. */
  async hardDelete(q: Querier, memoryId: string, buyerId: string): Promise<void> {
    await memoryRepo.getOwned(q, memoryId, buyerId); // isolation
    await q.query(`DELETE FROM memories WHERE id = $1`, [memoryId]);
  },
};
