import type { Querier } from '../querier';
import { runInTransaction } from '../db';

/**
 * `purge_hard_deletes` (daily cron): honor the delete promise. Accounts and
 * parents are soft-deleted immediately (deleted_at) and hard-deleted here once
 * the retention window has passed — giving support a recovery window while
 * keeping the "your data is gone within 30 days" promise true.
 *
 * What one run does, in order:
 *  1. Per purgeable user, IN ITS OWN TRANSACTION, so one failure can't stop
 *     the rest of the batch (a failure is counted and retried next run):
 *     anonymize the non-cascading references to that user. Eight columns
 *     reference users(id) without a cascading ON DELETE (consents.granted_by,
 *     memories.created_by, safety_flags.resolved_by,
 *     summary_deliveries.recipient_user, referrals.redeemed_by,
 *     audit_log.actor_id, beta_invites.redeemed_by_user_id,
 *     beta_invites.created_by_user_id — the last two also have ON DELETE SET
 *     NULL since migration 0017; listing them here keeps the purge correct
 *     even before that migration runs). Rows that live under the user's own parents cascade
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
 *  5. DELETE waitlist_signups older than DEFAULT_WAITLIST_RETENTION_DAYS (365).
 *     waitlist_signups has no FK to users — a signup predates any account and
 *     often never becomes one — so it runs on its own marketing-retention
 *     clock (created_at), not the account deletion promise above.
 */

export interface PurgeResult {
  /** ISO cutoff used: rows soft-deleted before this were purged. */
  cutoff: string;
  purgedUsers: number;
  /** Users whose purge failed this run (left soft-deleted; retried next run). */
  failedUsers: number;
  purgedParents: number;
  purgedTurns: number;
  purgedWaitlistSignups: number;
}

export const DEFAULT_RETENTION_DAYS = 30;
export const DEFAULT_WAITLIST_RETENTION_DAYS = 365;

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
  { table: 'beta_invites', column: 'redeemed_by_user_id' },
  { table: 'beta_invites', column: 'created_by_user_id' },
  { table: 'referral_rewards', column: 'referrer_user_id' },
  { table: 'referral_rewards', column: 'referred_user_id' },
];

export async function purgeHardDeletes(
  q: Querier,
  opts: { retentionDays?: number; waitlistRetentionDays?: number; now?: Date } = {},
): Promise<PurgeResult> {
  const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const waitlistRetentionDays = opts.waitlistRetentionDays ?? DEFAULT_WAITLIST_RETENTION_DAYS;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const waitlistCutoff = new Date(now.getTime() - waitlistRetentionDays * DAY_MS);

  // Parents of purgeable buyers: their analytics events are anonymized with the buyer.
  const { rows: purgeable } = await q.query<{ id: string }>(
    `SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < $1 ORDER BY id`,
    [cutoff],
  );

  let purgedUsers = 0;
  let failedUsers = 0;
  for (const { id: userId } of purgeable) {
    try {
      await runInTransaction(q, async (tx) => {
        for (const { table, column } of USER_REF_NULLIFICATIONS) {
          // Table/column names come from the constant above — never from input.
          await tx.query(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = $1`, [userId]);
        }
        // analytics_events has NO foreign keys, so a purge would never error —
        // the ids would just silently outlive the delete. Anonymize explicitly,
        // for the user and for every parent under them (which cascade below).
        await tx.query(`UPDATE analytics_events SET user_id = NULL WHERE user_id = $1`, [userId]);
        await tx.query(
          `UPDATE analytics_events SET parent_id = NULL
            WHERE parent_id IN (SELECT id FROM parents WHERE buyer_id = $1)`,
          [userId],
        );
        // Parents and everything beneath them cascade with the user.
        const { rowCount } = await tx.query(`DELETE FROM users WHERE id = $1 AND deleted_at IS NOT NULL`, [userId]);
        purgedUsers += rowCount ?? 0;
      });
    } catch (err) {
      failedUsers += 1;
      // Never log the error detail (a pg detail can echo row values).
      console.error('purge: user purge failed; will retry next run', userId, (err as { code?: string }).code ?? 'error');
    }
  }

  // analytics_events for soft-deleted parents (whose buyer is alive) — no FK, so anonymize explicitly.
  await q.query(
    `UPDATE analytics_events SET parent_id = NULL
      WHERE parent_id IN (SELECT id FROM parents WHERE deleted_at IS NOT NULL AND deleted_at < $1)`,
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

  // Waitlist signups age out on their own marketing-retention clock —
  // independent of any account, since the table has no FK to users.
  const waitlist = await q.query(
    `DELETE FROM waitlist_signups WHERE created_at < $1`,
    [waitlistCutoff],
  );

  return {
    cutoff: cutoff.toISOString(),
    purgedUsers,
    failedUsers,
    purgedParents: parents.rowCount ?? 0,
    purgedTurns: turns.rowCount ?? 0,
    purgedWaitlistSignups: waitlist.rowCount ?? 0,
  };
}
