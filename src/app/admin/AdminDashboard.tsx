'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';

interface Overview {
  buyers: number;
  parents_total: number;
  parents_activated: number;
  conversations_total: number;
  conversations_7d: number;
  open_flags: number;
  summaries_sent: number;
  waitlist: number;
}

type FlagSeverity = 'p0_crisis' | 'p1_acute_medical' | 'p2_welfare' | 'p3_abuse';
type FlagStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

interface SafetyFlag {
  id: string;
  parent_id: string;
  conversation_id: string | null;
  severity: FlagSeverity;
  status: FlagStatus;
  detail: string | null;
  created_at: string;
}

const SEVERITY: Record<FlagSeverity, { label: string; crisis: boolean }> = {
  p0_crisis: { label: 'Crisis', crisis: true },
  p1_acute_medical: { label: 'Acute medical', crisis: true },
  p2_welfare: { label: 'Welfare', crisis: false },
  p3_abuse: { label: 'Abuse', crisis: false },
};

export function AdminDashboard() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [flags, setFlags] = useState<SafetyFlag[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [o, f] = await Promise.all([
        api.get<{ overview: Overview }>('/api/admin/overview'),
        api.get<{ flags: SafetyFlag[] }>('/api/admin/flags'),
      ]);
      setOverview(o.overview);
      setFlags(f.flags);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
      else setError('Could not load the dashboard.');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="mt-4 text-base text-clay">{error}</p>;
  if (!overview || !flags) return <p className="mt-4 text-base text-muted">Loading…</p>;

  return (
    <div className="mt-8 space-y-10">
      <section>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Metric label="Buyers" value={overview.buyers} />
          <Metric
            label="Parents (active / total)"
            value={`${overview.parents_activated} / ${overview.parents_total}`}
          />
          <Metric
            label="Conversations"
            value={overview.conversations_total}
            sub={`${overview.conversations_7d} in the last 7 days`}
          />
          <Metric label="Summaries sent" value={overview.summaries_sent} />
          <Metric label="Open safety flags" value={overview.open_flags} alert={overview.open_flags > 0} />
          <Metric label="Waitlist" value={overview.waitlist} />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-ink">Safety flag queue</h2>
        <p className="mt-1 text-base text-muted">Open and in-review flags, highest severity first.</p>
        {flags.length === 0 ? (
          <p className="mt-4 rounded-xl border border-line bg-cloud p-6 text-base text-muted">
            Nothing in the queue. 🎉
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {flags.map((flag) => (
              <FlagRow key={flag.id} flag={flag} onChanged={load} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  alert,
}: {
  label: string;
  value: string | number;
  sub?: string;
  alert?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-cloud p-5 ${alert ? 'border-clay' : 'border-line'}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${alert ? 'text-clay' : 'text-ink'}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function FlagRow({ flag, onChanged }: { flag: SafetyFlag; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const sev = SEVERITY[flag.severity];

  async function setStatus(status: FlagStatus) {
    setFailed(false);
    setBusy(true);
    try {
      await api.patch(`/api/admin/flags/${flag.id}`, { status });
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      // Always reset — 'Start review' (open→reviewing) leaves this flag in the
      // queue, so the row stays mounted and must not be left permanently busy.
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-line bg-cloud p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                sev.crisis ? 'bg-clay text-cloud' : 'border border-line bg-mist text-muted'
              }`}
            >
              {sev.label}
            </span>
            <span className="text-xs uppercase tracking-wide text-muted">{flag.status}</span>
          </div>
          {flag.detail && <p className="mt-2 text-base text-ink">{flag.detail}</p>}
          <p className="mt-1 text-xs text-muted">
            Parent {flag.parent_id.slice(0, 8)} ·{' '}
            {new Date(flag.created_at).toLocaleString('en-US', { timeZone: 'UTC' })}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {flag.status === 'open' && (
            <button
              type="button"
              onClick={() => setStatus('reviewing')}
              disabled={busy}
              className="btn-secondary disabled:opacity-60"
            >
              Start review
            </button>
          )}
          <button
            type="button"
            onClick={() => setStatus('resolved')}
            disabled={busy}
            className="btn-primary disabled:opacity-60"
          >
            Resolve
          </button>
          <button
            type="button"
            onClick={() => setStatus('dismissed')}
            disabled={busy}
            className="text-sm text-muted underline disabled:opacity-60"
          >
            Dismiss
          </button>
        </div>
      </div>
      {failed && <p className="mt-2 text-xs text-clay">Couldn’t update. Please try again.</p>}
    </li>
  );
}
