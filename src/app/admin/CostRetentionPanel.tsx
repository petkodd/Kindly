'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';
import { formatUsdCents } from '@/lib/pricing';
import { Metric } from './Metric';

type Granularity = 'day' | 'week';

interface RetentionWindow {
  eligible: number;
  retained: number;
  pct: number | null;
}

interface RetentionMetrics {
  w1: RetentionWindow;
  w2: RetentionWindow;
  w4: RetentionWindow;
}

interface CostBucket {
  bucket_start: string;
  active_users: number;
  voice_minutes: number;
  total_cost_micros: number;
  cost_per_active_user_micros: number | null;
  cost_per_voice_minute_micros: number | null;
}

interface MetricsResponse {
  retention: RetentionMetrics;
  cost_buckets: CostBucket[];
  granularity: Granularity;
}

/** Micros (millionths of a dollar) -> a "$1.23" string, via the same formatter billing/pricing.ts already uses for cents. */
function fmtDollars(micros: number): string {
  return formatUsdCents(micros / 10_000);
}

function fmtPct(pct: number | null): string {
  return pct === null ? '—' : `${Math.round(pct * 100)}%`;
}

function fmtMaybeDollars(micros: number | null): string {
  return micros === null ? '—' : fmtDollars(micros);
}

export function CostRetentionPanel() {
  const router = useRouter();
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.get<MetricsResponse>(`/api/admin/metrics?granularity=${granularity}`);
      setData(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
      else setError('Could not load cost & retention metrics.');
    }
  }, [granularity, router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">Cost & retention</h2>
          <p className="mt-1 text-base text-muted">
            Infra cost and W1/W2/W4 retention, computed from real conversation and usage data.
          </p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-line text-sm">
          <button
            type="button"
            onClick={() => setGranularity('day')}
            className={`px-3 py-1.5 ${granularity === 'day' ? 'bg-ink text-cloud' : 'bg-cloud text-ink'}`}
          >
            Daily
          </button>
          <button
            type="button"
            onClick={() => setGranularity('week')}
            className={`px-3 py-1.5 ${granularity === 'week' ? 'bg-ink text-cloud' : 'bg-cloud text-ink'}`}
          >
            Weekly
          </button>
        </div>
      </div>

      {error && <p className="mt-4 text-base text-clay">{error}</p>}
      {!error && !data && <p className="mt-4 text-base text-muted">Loading…</p>}

      {data && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(['w1', 'w2', 'w4'] as const).map((key) => {
              const w = data.retention[key];
              return (
                <Metric
                  key={key}
                  label={`${key.toUpperCase()} retention`}
                  value={fmtPct(w.pct)}
                  sub={`${w.retained} / ${w.eligible} eligible parents`}
                />
              );
            })}
          </div>

          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-cloud">
            {data.cost_buckets.length === 0 ? (
              <p className="p-6 text-base text-muted">No usage in this window yet.</p>
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3">{granularity === 'day' ? 'Day' : 'Week of'}</th>
                    <th className="px-4 py-3">Active users</th>
                    <th className="px-4 py-3">Voice minutes</th>
                    <th className="px-4 py-3">Cost</th>
                    <th className="px-4 py-3">Cost / active user</th>
                    <th className="px-4 py-3">Cost / voice minute</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cost_buckets.map((b) => (
                    <tr key={b.bucket_start} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 text-ink">{b.bucket_start}</td>
                      <td className="px-4 py-3 text-ink">{b.active_users}</td>
                      <td className="px-4 py-3 text-ink">{b.voice_minutes.toFixed(1)}</td>
                      <td className="px-4 py-3 text-ink">{fmtDollars(b.total_cost_micros)}</td>
                      <td className="px-4 py-3 text-ink">{fmtMaybeDollars(b.cost_per_active_user_micros)}</td>
                      <td className="px-4 py-3 text-ink">{fmtMaybeDollars(b.cost_per_voice_minute_micros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}
