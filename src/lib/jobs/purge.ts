import type { Querier } from '../querier';

/**
 * `purge_hard_deletes` (daily cron): honor the delete promise. Accounts and
 * parents are soft-deleted immediately (deleted_at) and hard-deleted here once
 * the retention window has passed — giving support a recovery window while
 * keeping the "your data is gone within 30 days" promise true.
 *
 * What one run does, in order:
 *  1. Anonymize the non-cascading references to purgeable users. Six columns
 *     reference users(id) without ON DELETE (consents.granted_by,
 *     memories.created_by, safety_flags.resolved_by,
 *     summary_deliveries.recipient_user, referrals.redeemed_by,
 *     audit_log.actor_id). Rows that live under the user's own parents cascade
 *     away anyway; these NULLs cover rows OUTSIDE their cascade tree (e.g. a
 *     referral they redeemed, an audit row they wrote as admin) which would
 *     otherwise block the DELETE with an FK violation. The row survives,
 *     anonymized — the identity link is what's purged.
 *  2. DELETE the users; parents and everything beneath them (tokens, consents,
 *     memories, conversations + turns/transcripts, flags, summaries) cascade.
 *  3. DELETE any remaining soft-deleted parents past the window (their buyer
 *     is alive), cascading their subtree the same way.
 *  4. DELETE expired transcript turns — rows whose retention_purge_at has
 *     passed. Nothing sets that column yet (the product retention period is
 *     undecided), so this honors the schema's own mechanism without inventing
 *     a policy: once something stamps retention_purge_at, the purge is live.
 */

export interface PurgeResult {
  /** ISO cutoff used: rows soft-deleted before this were purged. */
  cutoff: string;
  purgedUsers: number;
  purgedParents: number;
  purgedTurns: number;
}

export const DEFAULT_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// Non-cascading FK columns onto users(id): nullify for purgeable users so the
// user DELETE can't be blocked by rows outside their cascade tree.
const USER_REF_NULLIFICATIONS: { table: string; column: string }[] = [
  { table: 'consents', column: 'granted_by' },
  { table: 'memories', column: 'created_by' },
  { table: 'safety_flags', column: 'resolved_by' },
  { table: 'summary_deliveries', column: 'recipient_user' },
  { table: 'referrals', column: 'redeemed_by' },
  { table: 'audit_log', column: 'actor_id' },
];

export async function purgeHardDeletes(
  q: Querier,
  opts: { retentionDays?: number; now?: Date } = {},
): Promise<PurgeResult> {
  const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = new Date((opts.now ?? new Date()).getTime() - retentionDays * DAY_MS);

  for (const { table, column } of USER_REF_NULLIFICATIONS) {
    // Table/column names come from the constant above — never from input.
    await q.query(
      `UPDATE ${table} SET ${column} = NULL
        WHERE ${column} IN (
          SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < $1
        )`,
      [cutoff],
    );
  }

  const users = await q.query(
    `DELETE FROM users
      WHERE deleted_at IS NOT NULL AND deleted_at < $1
      RETURNING id`,
    [cutoff],
  );

  // Parents soft-deleted past the window whose buyer survives (a purged buyer's
  // parents are already gone via the cascade above).
  const parents = await q.query(
    `DELETE FROM parents
      WHERE deleted_at IS NOT NULL AND deleted_at < $1
      RETURNING id`,
    [cutoff],
  );

  // Expired transcripts: honor per-turn retention stamps when present.
  const turns = await q.query(
    `DELETE FROM conversation_turns
      WHERE retention_purge_at IS NOT NULL AND retention_purge_at < $1
      RETURNING id`,
    [opts.now ?? new Date()],
  );

  return {
    cutoff: cutoff.toISOString(),
    purgedUsers: users.rows.length,
    purgedParents: parents.rows.length,
    purgedTurns: turns.rows.length,
  };
}
