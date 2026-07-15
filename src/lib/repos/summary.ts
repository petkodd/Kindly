import type { Querier } from '../querier';
import {
  type WeeklySummary,
  type SummaryDelivery,
  PreconditionError,
} from '../types';
import { consentRepo } from './consent';

/**
 * Weekly summaries are the family-facing heartbeat of Kindly. They are built
 * ONLY from family-safe signals:
 *  - per-conversation summaries written by the summarize job
 *  - coarse, non-clinical mood signals ('warm'|'flat'|'low')
 * Restricted memories never reach a summary (see memoryRepo.listForFamily), and
 * delivery to any recipient requires an active summary_recipient consent.
 */

export interface WeekBounds {
  /** Inclusive Monday, YYYY-MM-DD. */
  periodStart: string;
  /** Inclusive Sunday, YYYY-MM-DD. */
  periodEnd: string;
  /** Start of the period (00:00 UTC). */
  startTs: Date;
  /** Exclusive upper bound for timestamp filtering (next Monday 00:00 UTC). */
  nextStartTs: Date;
}

interface ConversationRow {
  summary_text: string | null;
  mood_signal: string | null;
}

const ISO_DAY = 24 * 60 * 60 * 1000;

/** Monday-anchored ISO week containing `ref`, computed in UTC for determinism. */
export function weekBounds(ref: Date = new Date()): WeekBounds {
  const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const offset = (start.getUTCDay() + 6) % 7; // 0 = Monday
  start.setUTCDate(start.getUTCDate() - offset);
  const end = new Date(start.getTime() + 6 * ISO_DAY);
  const nextStart = new Date(start.getTime() + 7 * ISO_DAY);
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    startTs: start,
    nextStartTs: nextStart,
  };
}

/** Compose the family-facing body from this week's conversation signals. */
function composeBody(
  firstName: string,
  convs: ConversationRow[],
): { bodyLong: string; bodyShort: string; hasConcern: boolean } {
  const chats = convs.length;
  const highlights = convs.map((c) => c.summary_text?.trim()).filter(Boolean) as string[];
  const moods = convs.map((c) => c.mood_signal).filter(Boolean) as string[];
  const hasConcern = moods.includes('low');

  if (chats === 0) {
    const bodyShort = `We didn't hear from ${firstName} this week.`;
    return {
      bodyShort,
      bodyLong: `${bodyShort} No conversations took place — that's perfectly okay. We'll be here whenever ${firstName} wants to talk.`,
      hasConcern: false,
    };
  }

  const chatWord = chats === 1 ? 'conversation' : 'conversations';
  const bodyShort = `${firstName} had ${chats} ${chatWord} with Kindly this week.`;

  const lines = [bodyShort];
  if (highlights.length > 0) {
    lines.push('', 'Some moments from the week:');
    for (const h of highlights) lines.push(`• ${h}`);
  }
  if (hasConcern) {
    lines.push(
      '',
      `A gentle heads-up: ${firstName} seemed a little low in one of their chats. Nothing alarming — it may be worth a gentle check-in this week.`,
    );
  }

  return { bodyShort, bodyLong: lines.join('\n'), hasConcern };
}

export const summaryRepo = {
  weekBounds,

  /**
   * Generate (or refresh) the current-week preview for a parent and return it.
   * Idempotent per (parent_id, period_start). A summary that has already been
   * sent is returned untouched — we never silently regenerate sent history.
   */
  async preview(
    q: Querier,
    parentId: string,
    firstName: string,
    ref: Date = new Date(),
  ): Promise<WeeklySummary> {
    const b = weekBounds(ref);

    const { rows: convRows } = await q.query<ConversationRow>(
      `SELECT summary_text, mood_signal
         FROM conversations
        WHERE parent_id = $1 AND started_at >= $2 AND started_at < $3
        ORDER BY started_at ASC`,
      [parentId, b.startTs, b.nextStartTs],
    );

    const { bodyLong, bodyShort, hasConcern } = composeBody(firstName, convRows);

    // Refresh an existing week's row in place — but never rewrite one that has
    // already been sent (sent history is immutable).
    const refresh = async (existing: WeeklySummary): Promise<WeeklySummary> => {
      if (existing.status === 'sent') return existing;
      const { rows } = await q.query<WeeklySummary>(
        `UPDATE weekly_summaries
            SET period_end = $2, body_long = $3, body_short = $4,
                has_concern = $5, status = 'preview', generated_at = now()
          WHERE id = $1
          RETURNING *`,
        [existing.id, b.periodEnd, bodyLong, bodyShort, hasConcern],
      );
      return rows[0];
    };

    const load = async (): Promise<WeeklySummary | undefined> => {
      const { rows } = await q.query<WeeklySummary>(
        `SELECT * FROM weekly_summaries WHERE parent_id = $1 AND period_start = $2`,
        [parentId, b.periodStart],
      );
      return rows[0];
    };

    const existing = await load();
    if (existing) return refresh(existing);

    // No row yet — insert. Two concurrent first-previews can both reach here;
    // the loser hits the UNIQUE(parent_id, period_start) constraint, so we
    // recover by refreshing the row the winner just created (idempotent).
    try {
      const { rows } = await q.query<WeeklySummary>(
        `INSERT INTO weekly_summaries
           (parent_id, period_start, period_end, status, body_long, body_short, has_concern)
         VALUES ($1, $2, $3, 'preview', $4, $5, $6)
         RETURNING *`,
        [parentId, b.periodStart, b.periodEnd, bodyLong, bodyShort, hasConcern],
      );
      return rows[0];
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err; // unique_violation
      const raced = await load();
      if (!raced) throw err;
      return refresh(raced);
    }
  },

  /** Past summaries for a parent, newest first. */
  async list(q: Querier, parentId: string): Promise<WeeklySummary[]> {
    const { rows } = await q.query<WeeklySummary>(
      `SELECT * FROM weekly_summaries WHERE parent_id = $1 ORDER BY period_start DESC`,
      [parentId],
    );
    return rows;
  },

  /**
   * Deliver the current-week summary to every consented recipient. Refuses with
   * a PreconditionError (API → 409) when no active summary_recipient consent
   * exists — consent is a hard gate on every delivery.
   */
  async send(
    q: Querier,
    parentId: string,
    firstName: string,
    ref: Date = new Date(),
  ): Promise<{ summary: WeeklySummary; deliveries: SummaryDelivery[] }> {
    // Only ACCEPTED recipients — a pending (unaccepted) invite must never
    // receive a summary.
    const recipients = await consentRepo.listAcceptedRecipients(q, parentId);
    if (recipients.length === 0) {
      throw new PreconditionError(
        'No consented summary recipient. Invite a recipient before sending.',
      );
    }

    const summary = await summaryRepo.preview(q, parentId, firstName, ref);

    // Idempotent: a recipient already delivered to (non-failed) for this summary
    // is skipped, so a re-send or double-click never delivers twice.
    const { rows: priorRows } = await q.query<SummaryDelivery>(
      `SELECT * FROM summary_deliveries WHERE summary_id = $1 AND status <> 'failed'`,
      [summary.id],
    );
    const alreadyDelivered = new Set(priorRows.map((d) => d.consent_id));
    const deliveries: SummaryDelivery[] = [...priorRows];

    for (const consent of recipients) {
      if (alreadyDelivered.has(consent.id)) continue;
      // recipient_user stays null: the recipient is identified by the consent
      // (detail.recipient_email) and is typically not yet a Kindly user. It is
      // NOT the buyer in consent.granted_by.
      //
      // ON CONFLICT closes the cross-request race: a concurrent send that won
      // the insert leaves RETURNING empty here, so we never double-deliver
      // (uq_summary_delivery_consent — migration 0002).
      const { rows } = await q.query<SummaryDelivery>(
        `INSERT INTO summary_deliveries
           (summary_id, recipient_user, channel, consent_id, status, sent_at)
         VALUES ($1, NULL, 'email', $2, 'sent', now())
         ON CONFLICT (summary_id, consent_id) DO NOTHING
         RETURNING *`,
        [summary.id, consent.id],
      );
      if (rows[0]) deliveries.push(rows[0]);
    }

    const { rows } = await q.query<WeeklySummary>(
      `UPDATE weekly_summaries SET status = 'sent' WHERE id = $1 RETURNING *`,
      [summary.id],
    );

    return { summary: rows[0], deliveries };
  },
};
