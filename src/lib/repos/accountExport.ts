import type { Querier } from '../querier';
import { userRepo } from './user';
import { parentRepo } from './parent';
import { memoryRepo } from './memory';
import { summaryRepo } from './summary';

/**
 * Everything the trust page promises a buyer can download about themselves
 * and the parents they set up, as one JSON document.
 *
 * Included: the account, each parent profile, its memories (restricted ones
 * are never stored, and `memoryRepo.list` excludes them regardless), weekly
 * summaries, consents, subscriptions, and conversation transcripts still
 * within the 30-day retention window.
 *
 * Deliberately NOT included: safety flags and their reviewer notes (P3 —
 * abuse, scams — must never reach family, and the notes are staff working
 * data), password hashes, session data, and invite token hashes.
 */
export interface AccountExport {
  exported_at: string;
  format_version: 1;
  account: Record<string, unknown>;
  parents: Record<string, unknown>[];
}

const PARENT_FIELDS = [
  'id', 'first_name', 'pronouns', 'relationship', 'city', 'language', 'large_text', 'voice_first',
  'speech_rate', 'activated_at', 'created_at',
] as const;

function pick<T extends Record<string, unknown>>(row: T, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, row[f]]));
}

export async function buildAccountExport(q: Querier, userId: string, now: Date = new Date()): Promise<AccountExport> {
  const account = await userRepo.getAccount(q, userId);
  const { rows: extra } = await q.query<Record<string, unknown>>(
    `SELECT alert_phone, sms_alert_consent_at, auto_send_summaries FROM users WHERE id = $1`,
    [userId],
  );
  const parents = await parentRepo.listForBuyer(q, userId);

  const parentDocs: Record<string, unknown>[] = [];
  for (const parent of parents) {
    const [memories, summaries, consents, subscriptions, conversations] = await Promise.all([
      memoryRepo.list(q, parent.id),
      summaryRepo.list(q, parent.id),
      q.query<Record<string, unknown>>(
        `SELECT id, kind, granted_at, revoked_at, detail FROM consents WHERE parent_id = $1 ORDER BY granted_at ASC`,
        [parent.id],
      ),
      q.query<Record<string, unknown>>(
        `SELECT plan, status, billing_interval, current_period_end, created_at FROM subscriptions
          WHERE parent_id = $1 ORDER BY created_at ASC`,
        [parent.id],
      ),
      q.query<{ id: string; started_at: string; ended_at: string | null; channel: string; summary_text: string | null }>(
        `SELECT id, started_at, ended_at, channel, summary_text FROM conversations
          WHERE parent_id = $1 ORDER BY started_at ASC`,
        [parent.id],
      ),
    ]);

    const conversationDocs = [];
    for (const c of conversations.rows) {
      const { rows: turns } = await q.query<{ role: string; content: string; created_at: string }>(
        `SELECT role, content, created_at FROM conversation_turns
          WHERE conversation_id = $1 AND (retention_purge_at IS NULL OR retention_purge_at > $2)
          ORDER BY created_at ASC`,
        [c.id, now],
      );
      conversationDocs.push({ ...c, turns });
    }

    parentDocs.push({
      ...pick(parent as unknown as Record<string, unknown>, PARENT_FIELDS),
      memories: memories.map((m) => ({
        layer: m.layer,
        key: m.mem_key,
        value: m.mem_value,
        source: m.source,
        status: m.status,
        sensitivity: m.sensitivity,
        created_at: m.created_at,
      })),
      weekly_summaries: summaries.map((s) => pick(s as unknown as Record<string, unknown>, [
        'period_start', 'period_end', 'status', 'body_long', 'body_short', 'generated_at',
      ])),
      consents: consents.rows.map((c) => {
        // Never export invite token hashes.
        const detail = { ...((c.detail as Record<string, unknown> | null) ?? {}) };
        delete detail.invite_token_hash;
        return { ...c, detail };
      }),
      subscriptions: subscriptions.rows,
      conversations: conversationDocs,
    });
  }

  return {
    exported_at: now.toISOString(),
    format_version: 1,
    account: { ...pick(account as unknown as Record<string, unknown>, ['id', 'email', 'full_name', 'created_at']), ...(extra[0] ?? {}) },
    parents: parentDocs,
  };
}
