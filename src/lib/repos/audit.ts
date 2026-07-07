import type { Querier } from '../querier';

/**
 * Audit log for admin + sensitive reads (api_plan_v1.md: "All admin + sensitive
 * reads write to audit_log"). Fire-and-forget from the caller's perspective, but
 * awaited so it actually persists.
 */
export const auditRepo = {
  async log(
    q: Querier,
    input: {
      actorId: string | null;
      action: string;
      targetType: string;
      targetId?: string | null;
      meta?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await q.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.actorId,
        input.action,
        input.targetType,
        input.targetId ?? null,
        input.meta ? JSON.stringify(input.meta) : null,
      ],
    );
  },
};
