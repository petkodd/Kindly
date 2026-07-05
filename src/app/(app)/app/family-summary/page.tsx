'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';

interface Parent {
  id: string;
  first_name: string;
}

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
  const router = useRouter();
  const [parents, setParents] = useState<Parent[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    api
      .get<{ parents: Parent[] }>('/api/parents')
      .then((r) => {
        setParents(r.parents);
        if (r.parents.length > 0) setSelected(r.parents[0].id);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/login');
        else setLoadError('Could not load your family.');
      });
  }, [router]);

  if (loadError) return <p className="text-base text-clay">{loadError}</p>;
  if (!parents) return <p className="text-base text-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="eyebrow">Weekly family summary</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
          The week in your family
        </h1>
        <p className="mt-2 text-base text-muted">
          A warm, family-safe recap built only from this week&rsquo;s conversations. Preview it,
          then send it to the people who&rsquo;ve been invited.
        </p>
      </div>

      {parents.length === 0 ? (
        <div className="rounded-xl border border-line bg-cloud p-6">
          <p className="text-base text-ink">You haven&rsquo;t set up a parent yet.</p>
          <Link href="/app/onboarding" className="btn-primary mt-4 inline-block">
            Set up the gift
          </Link>
        </div>
      ) : (
        <>
          {parents.length > 1 && (
            <ParentPicker parents={parents} selected={selected} onSelect={setSelected} />
          )}
          {selected && <SummaryPanel key={selected} parentId={selected} />}
        </>
      )}
    </div>
  );
}

function ParentPicker({
  parents,
  selected,
  onSelect,
}: {
  parents: Parent[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {parents.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p.id)}
          aria-pressed={p.id === selected}
          className={`rounded-full border px-4 py-2 text-base ${
            p.id === selected
              ? 'border-sage bg-sage text-cloud'
              : 'border-line bg-cloud text-ink hover:border-sage'
          }`}
        >
          {p.first_name}
        </button>
      ))}
    </div>
  );
}

function SummaryPanel({ parentId }: { parentId: string }) {
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
        onSent={(updated) => {
          setPreview(updated);
          void load();
        }}
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
  onSent,
}: {
  parentId: string;
  summary: WeeklySummary;
  onSent: (updated: WeeklySummary) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [needsRecipient, setNeedsRecipient] = useState(false);
  const sent = summary.status === 'sent';

  async function send() {
    setStatus('');
    setNeedsRecipient(false);
    setBusy(true);
    try {
      const r = await api.post<{ summary: WeeklySummary; deliveries: Delivery[] }>(
        `/api/parents/${parentId}/summary/send`,
      );
      const count = r.deliveries.filter((d) => d.status !== 'failed').length;
      setStatus(
        count === 1 ? 'Sent to 1 recipient.' : `Sent to ${count} recipients.`,
      );
      onSent(r.summary);
    } catch (err) {
      // 409: no consented recipient yet — the send is gated on consent.
      if (err instanceof ApiError && err.status === 409) {
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

      {summary.has_concern && (
        <p className="mt-4 rounded-lg border border-clay bg-mist px-4 py-3 text-sm font-semibold text-ink">
          This week includes a gentle heads-up — see the note below.
        </p>
      )}

      <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-ink">
        {summary.body_long || summary.body_short}
      </p>

      <div className="mt-6 border-t border-line pt-6">
        {sent ? (
          <p className="text-base text-muted">
            This week&rsquo;s summary has been sent. You can send it again if you invite more
            recipients.
          </p>
        ) : (
          <p className="text-base text-muted">
            When you&rsquo;re ready, send this to the family members who&rsquo;ve accepted an
            invitation.
          </p>
        )}

        {needsRecipient ? (
          <div className="mt-4 rounded-lg border border-clay bg-mist px-4 py-3">
            <p className="text-base text-ink">
              No one has accepted an invitation to receive summaries yet.
            </p>
            <Link href="/app/referrals" className="mt-2 inline-block text-base text-sage underline">
              Invite a family member
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={busy}
            className="btn-primary mt-4 disabled:opacity-60"
          >
            {busy ? 'Sending…' : sent ? 'Send again' : 'Send this week’s summary'}
          </button>
        )}

        {status && <p className="mt-3 text-sm text-muted">{status}</p>}
      </div>
    </section>
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
        {summaries.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between rounded-xl border border-line bg-cloud px-4 py-3"
          >
            <div>
              <p className="text-base text-ink">{fmtRange(s.period_start, s.period_end)}</p>
              {s.body_short && <p className="text-sm text-muted">{s.body_short}</p>}
            </div>
            <StatusBadge status={s.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
