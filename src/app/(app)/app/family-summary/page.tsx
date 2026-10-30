'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/apiClient';
import { ParentPicker } from '@/components/ParentPicker';
import { EmptyParentState } from '@/components/EmptyParentState';
import { ParentGate } from '@/components/ParentGate';
import { useEmailVerified, UNVERIFIED_REASON } from '@/hooks/useEmailVerified';

interface WeeklySummary {
  id: string;
  period_start: string;
  period_end: string;
  status: 'draft' | 'preview' | 'sent';
  body_long: string | null;
  body_short: string | null;
  has_concern: boolean;
}

interface Delivery {
  id: string;
  status: string;
}

/** 'YYYY-MM-DD' → 'Jun 29' / 'Jul 5, 2026', UTC to match the server's ISO weeks. */
function fmtDay(iso: string, withYear = false): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

function fmtRange(start: string, end: string): string {
  return `${fmtDay(start)} – ${fmtDay(end, true)}`;
}

const STATUS_LABEL: Record<WeeklySummary['status'], string> = {
  draft: 'Draft',
  preview: 'Preview',
  sent: 'Sent',
};

export default function FamilySummaryPage() {
  return (
    <ParentGate>
      {({ parents, selected, setSelected }) => {
        const isSelf = parents.find((p) => p.id === selected)?.relationship === 'self';
        return (
          <div className="mx-auto max-w-2xl space-y-8">
            <div>
              <p className="eyebrow">Weekly summary</p>
              <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
                {isSelf ? 'Your week with Dearly' : 'The week in your family'}
              </h1>
              <p className="mt-2 text-base text-muted">
                {isSelf
                  ? 'A warm, private recap built only from last week’s conversations. Preview it, then send it to anyone you’d like to keep in the loop.'
                  : 'A warm, family-safe recap built only from last week’s conversations. Preview it, then send it to the people who’ve been invited.'}
              </p>
            </div>

            {parents.length === 0 ? (
              <EmptyParentState />
            ) : (
              <>
                <ParentPicker parents={parents} selected={selected} onSelect={setSelected} />
                {selected && <SummaryPanel key={selected} parentId={selected} isSelf={isSelf} />}
              </>
            )}
          </div>
        );
      }}
    </ParentGate>
  );
}

function SummaryPanel({ parentId, isSelf }: { parentId: string; isSelf: boolean }) {
  const [preview, setPreview] = useState<WeeklySummary | null>(null);
  const [history, setHistory] = useState<WeeklySummary[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [p, h] = await Promise.all([
        api.get<{ summary: WeeklySummary }>(`/api/parents/${parentId}/summary/preview`),
        api.get<{ summaries: WeeklySummary[] }>(`/api/parents/${parentId}/summaries`),
      ]);
      setPreview(p.summary);
      setHistory(h.summaries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this summary.');
    }
  }, [parentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-base text-clay">{error}</p>;
  if (!preview || !history) return <p className="text-base text-muted">Loading summary…</p>;

  // The current-week preview is also the newest history row — don't list it twice.
  const past = history.filter((s) => s.id !== preview.id);

  return (
    <div className="space-y-8">
      <PreviewCard
        parentId={parentId}
        summary={preview}
        isSelf={isSelf}
        // send() already returns the updated summary; applying it locally avoids
        // two redundant GETs (the refetched current-week row is filtered from
        // `past` anyway, and its sent status is already reflected here).
        onSent={setPreview}
      />
      <PastSummaries summaries={past} />
    </div>
  );
}

function StatusBadge({ status }: { status: WeeklySummary['status'] }) {
  const sent = status === 'sent';
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
        sent ? 'bg-sage text-cloud' : 'border border-line bg-mist text-muted'
      }`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function PreviewCard({
  parentId,
  summary,
  isSelf,
  onSent,
}: {
  parentId: string;
  summary: WeeklySummary;
  isSelf: boolean;
  onSent: (updated: WeeklySummary) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [needsRecipient, setNeedsRecipient] = useState(false);
  const sent = summary.status === 'sent';
  const emailVerified = useEmailVerified();
  const blockedUnverified = emailVerified === false;
  const body = (summary.body_long || summary.body_short || '').trim();

  async function send() {
    setStatus('');
    setNeedsRecipient(false);
    setBusy(true);
    try {
      const r = await api.post<{ summary: WeeklySummary; deliveries: Delivery[] }>(
        `/api/parents/${parentId}/summary/send`,
      );
      const count = r.deliveries.filter((d) => d.status === 'sent').length;
      const simulated = r.deliveries.filter((d) => d.status === 'simulated').length;
      const recipients = (n: number) => (n === 1 ? '1 recipient' : `${n} recipients`);
      const parts: string[] = [];
      if (count > 0) parts.push(`Sent to ${recipients(count)}.`);
      // Demo mode / no email key: say plainly that nothing actually went out.
      if (simulated > 0) parts.push(`Simulated for ${recipients(simulated)} — demo mode, no email was sent.`);
      setStatus(parts.join(' ') || 'Sent to 0 recipients.');
      onSent(r.summary);
    } catch (err) {
      // 409 parent_consent_required: the parent hasn't said yes to sharing
      // summaries yet (chat 9). Any other 409: no accepted recipient yet.
      if (err instanceof ApiError && err.status === 409 && err.code === 'parent_consent_required') {
        setStatus(
          isSelf
            ? 'You haven’t agreed to share weekly summaries yet. Dearly will ask you the next time you talk.'
            : 'Your parent hasn’t agreed to share weekly summaries yet. Dearly asks them, in their own words, the next time they talk — nothing is sent until they say yes.',
        );
      } else if (err instanceof ApiError && err.status === 409) {
        setNeedsRecipient(true);
      } else {
        setStatus(err instanceof ApiError ? err.message : 'Could not send the summary.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-cloud p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-ink">
          {fmtRange(summary.period_start, summary.period_end)}
        </h2>
        <StatusBadge status={summary.status} />
      </div>

      {/* has_concern is always false for new summaries (D3 default, chat 9);
          older rows may still carry it. The old copy pointed to a "note
          below" that never existed, so the badge now stands on its own. */}
      {summary.has_concern && (
        <p className="mt-4 rounded-lg border border-clay bg-mist px-4 py-3 text-sm font-semibold text-ink">
          This week&rsquo;s summary includes a gentle heads-up.
        </p>
      )}

      {body ? (
        <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-ink">{body}</p>
      ) : (
        <p className="mt-4 text-base text-muted">
          There&rsquo;s nothing to share for this week yet. A summary is written from the week&rsquo;s conversations, so it
          fills in once {isSelf ? 'you' : 'your parent'} {isSelf ? 'have' : 'has'} talked with Dearly.
        </p>
      )}

      <div className="mt-6 border-t border-line pt-6">
        {sent ? (
          <p className="text-base text-muted">
            Last week&rsquo;s summary has been sent. You can send it again if you invite more
            recipients.
          </p>
        ) : (
          <p className="text-base text-muted">
            {isSelf
              ? 'When you’re ready, send this to anyone you’ve invited to follow along.'
              : 'When you’re ready, send this to the family members who’ve accepted an invitation.'}
          </p>
        )}

        {needsRecipient ? (
          <div className="mt-4 rounded-lg border border-clay bg-mist px-4 py-3">
            <p className="text-base text-ink">
              No one has accepted an invitation to receive summaries yet.
            </p>
            <Link href="/app/referrals" className="mt-2 inline-block text-base text-sage underline">
              {isSelf ? 'Invite someone to follow along' : 'Invite a family member'}
            </Link>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={send}
              disabled={busy || blockedUnverified || !body}
              aria-describedby={blockedUnverified ? 'send-blocked-reason' : undefined}
              className="btn-primary mt-4 disabled:opacity-60"
            >
              {busy ? 'Sending…' : sent ? 'Send again' : 'Send last week’s summary'}
            </button>
            {blockedUnverified && (
              <p id="send-blocked-reason" className="mt-2 text-base text-clay">
                {UNVERIFIED_REASON}
              </p>
            )}
          </>
        )}

        {status && <p className="mt-3 text-sm text-muted">{status}</p>}

        <AutoSendToggle />
      </div>
    </section>
  );
}

/**
 * Decision D5: the buyer opts in to automatic sending. When on, the summary
 * for the week that just ended goes to accepted recipients every Monday.
 */
function AutoSendToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get<{ account: { auto_send_summaries?: boolean } }>('/api/me')
      .then((r) => active && setOn(!!r.account.auto_send_summaries))
      .catch(() => active && setOn(null));
    return () => {
      active = false;
    };
  }, []);

  if (on === null) return null;

  async function toggle(next: boolean) {
    setSaving(true);
    setNote('');
    try {
      const r = await api.patch<{ account: { auto_send_summaries: boolean } }>('/api/me', { auto_send_summaries: next });
      setOn(r.account.auto_send_summaries);
      setNote(next ? 'Summaries will be sent automatically every Monday.' : 'Automatic sending is off.');
    } catch {
      setNote('Could not save that setting. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6">
      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-base text-ink">
        <input
          type="checkbox"
          className="h-6 w-6 accent-sageDeep"
          checked={on}
          disabled={saving}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Send it automatically every Monday
      </label>
      {note && (
        <p role="status" className="mt-1 text-base text-muted">
          {note}
        </p>
      )}
    </div>
  );
}

function PastSummaries({ summaries }: { summaries: WeeklySummary[] }) {
  if (summaries.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-ink">Past weeks</h2>
        <p className="mt-2 text-base text-muted">No earlier summaries yet.</p>
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Past weeks</h2>
      <ul className="mt-4 space-y-3">
        {summaries.map((s) => {
          const body = (s.body_long || s.body_short || '').trim();
          return (
            <li key={s.id} className="rounded-xl border border-line bg-cloud">
              {/* Native disclosure: keyboard and screen-reader friendly with no extra script. */}
              <details className="group">
                <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-4 px-4 py-3">
                  <span>
                    <span className="block text-base text-ink">{fmtRange(s.period_start, s.period_end)}</span>
                    <span className="block text-sm text-sageDeep underline group-open:hidden">Show summary</span>
                    <span className="hidden text-sm text-sageDeep underline group-open:block">Hide summary</span>
                  </span>
                  <StatusBadge status={s.status} />
                </summary>
                <div className="border-t border-line px-4 py-3">
                  {body ? (
                    <p className="whitespace-pre-line text-base leading-relaxed text-ink">{body}</p>
                  ) : (
                    <p className="text-base text-muted">Nothing was written for this week.</p>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
