import type { Querier } from '../querier';
import {
  type Memory,
  type MemoryLayer,
  type MemorySource,
  type Sensitivity,
  ValidationError,
  PreconditionError,
  NotFoundError,
} from '../types';

const LAYERS: MemoryLayer[] = ['profile', 'core', 'interest', 'episodic', 'sensitive'];

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
    const key = (input.key ?? '').trim();
    const value = (input.value ?? '').trim();
    if (!key) throw new ValidationError('memory key is required');
    if (!value) throw new ValidationError('memory value is required');
    if (!LAYERS.includes(input.layer)) throw new ValidationError('memory layer is invalid');

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
        input.sensitivity ?? 'normal',
        input.createdBy ?? null,
        input.decayAt ?? null,
      ],
    );
    return rows[0];
  },

  /** List memories for a parent, optionally filtered by layer/status. */
  async list(
    q: Querier,
    parentId: string,
    opts: { layer?: MemoryLayer; status?: string } = {},
  ): Promise<Memory[]> {
    const clauses = ['parent_id = $1'];
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
   * view — confirmed only, never restricted — but ordered for recency and
   * capped, since context has a token budget (semantic retrieval via embeddings
   * comes later; recency is the alpha proxy).
   */
  async retrieveForCompanion(q: Querier, parentId: string, limit = 12): Promise<Memory[]> {
    const { rows } = await q.query<Memory>(
      `SELECT * FROM memories
       WHERE parent_id = $1
         AND status = 'confirmed'
         AND sensitivity <> 'restricted'
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
