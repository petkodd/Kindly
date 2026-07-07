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
 *  2b. Anonymize analytics_events.user_id/parent_id for everything being
 *     purged — those columns have NO foreign keys, so without this the ids
 *     would silently outlive the delete (no error would ever surface it).
 *  3. DELETE any remaining soft-deleted parents past the window (their buyer
 *     is alive), cascading their subtree the same way.
 *  4. DELETE expired transcript turns — rows whose retention_purge_at has
 *     passed. Stamped at session end (src/lib/jobs/sessionEnd.ts,
 *     DEFAULT_TRANSCRIPT_RETENTION_DAYS = 30) regardless of account deletion —
 *     transcripts expire on their own clock, independent of the user/parent
 *     purge above.
 *
 * Deliberate carve-out: waitlist_signups.email is NOT purged — it predates the
 * account and isn't linked to it. Whether the deletion promise should cover
 * the marketing funnel is a pending privacy decision; revisit when decided.
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
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);

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

  // analytics_events has NO foreign keys, so a purge would never error — the
  // ids would just silently outlive the delete. Anonymize them explicitly:
  // events of purgeable users, and events of parents that are about to go
  // (soft-deleted past the window, or belonging to a purgeable buyer — a
  // buyer's parents cascade even when never individually soft-deleted).
  await q.query(
    `UPDATE analytics_events SET user_id = NULL
      WHERE user_id IN (
        SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < $1
      )`,
    [cutoff],
  );
  await q.query(
    `UPDATE analytics_events SET parent_id = NULL
      WHERE parent_id IN (
        SELECT id FROM parents
         WHERE (deleted_at IS NOT NULL AND deleted_at < $1)
            OR buyer_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < $1)
      )`,
    [cutoff],
  );

  // NOTE: the statements in this run auto-commit individually (Querier exposes
  // no transaction). A mid-run crash leaves refs anonymized with the user row
  // still present; every statement re-derives its set from deleted_at, so the
  // next daily run completes the purge — self-healing, at the cost of possibly
  // anonymizing a run early.
  const users = await q.query(
    `DELETE FROM users
      WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
    [cutoff],
  );

  // Parents soft-deleted past the window whose buyer survives (a purged buyer's
  // parents are already gone via the cascade above).
  const parents = await q.query(
    `DELETE FROM parents
      WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
    [cutoff],
  );

  // Expired transcripts: honor per-turn retention stamps when present. Compared
  // against `now` (an absolute expiry), not the retention cutoff.
  const turns = await q.query(
    `DELETE FROM conversation_turns
      WHERE retention_purge_at IS NOT NULL AND retention_purge_at < $1`,
    [now],
  );

  return {
    cutoff: cutoff.toISOString(),
    purgedUsers: users.rowCount ?? 0,
    purgedParents: parents.rowCount ?? 0,
    purgedTurns: turns.rowCount ?? 0,
  };
}
