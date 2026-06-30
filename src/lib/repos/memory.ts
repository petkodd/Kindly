import type { Querier } from '../querier';
import {
  type Memory,
  type MemoryLayer,
  type MemorySource,
  type Sensitivity,
  ValidationError,
  PreconditionError,
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

  /** Confirm a proposed memory (parent or buyer approval). */
  async confirm(q: Querier, memoryId: string): Promise<Memory> {
    const { rows } = await q.query<Memory>(
      `UPDATE memories SET status = 'confirmed'
       WHERE id = $1 AND status = 'proposed'
       RETURNING *`,
      [memoryId],
    );
    if (rows.length === 0) {
      throw new PreconditionError('Memory not found or not in a proposed state.');
    }
    return rows[0];
  },

  async retire(q: Querier, memoryId: string): Promise<void> {
    await q.query(`UPDATE memories SET status = 'retired' WHERE id = $1`, [memoryId]);
  },

  /** Hard-delete a memory (honors the user's delete request). */
  async hardDelete(q: Querier, memoryId: string): Promise<void> {
    await q.query(`DELETE FROM memories WHERE id = $1`, [memoryId]);
  },
};
