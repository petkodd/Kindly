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
  stt_cost_micros: number;
  tts_cost_micros: number;
  llm_cost_micros: number;
  total_cost_micros: number;
  cost_per_active_user_micros: number | null;
  cost_per_voice_minute_micros: number | null;
}

interface TopSpender {
  parent_ref: string;
  conversations: number;
  voice_minutes: number;
  llm_cost_micros: number;
  speech_cost_micros: number;
  total_cost_micros: number;
}

interface MetricsResponse {
  retention: RetentionMetrics;
  cost_buckets: CostBucket[];
  top_spenders?: TopSpender[];
  granularity: Granularity;
}

/**
 * Micros (millionths of a dollar) -> "$1.23", via the same formatter
 * billing/pricing.ts uses for cents. Amounts under a cent (cost per voice
 * minute is typically ~$0.004) keep 4 decimals, so they never show as "$0.00".
 */
export function fmtDollars(micros: number): string {
  if (micros > 0 && micros < 10_000) return `$${(micros / 1_000_000).toFixed(4)}`;
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

          {(() => {
            const latest = data.cost_buckets[data.cost_buckets.length - 1];
            if (!latest) return null;
            const period = granularity === 'week' ? 'this week' : 'today';
            return (
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Metric
                  label={`Cost per active parent (${period})`}
                  value={fmtMaybeDollars(latest.cost_per_active_user_micros)}
                  sub={`${latest.active_users} active · ${fmtDollars(latest.total_cost_micros)} total`}
                />
                <Metric
                  label={`Cost per voice minute (${period})`}
                  value={fmtMaybeDollars(latest.cost_per_voice_minute_micros)}
                  sub={`${latest.voice_minutes.toFixed(1)} voice minutes`}
                />
                <Metric
                  label={`Split (${period})`}
                  value={`LLM ${fmtDollars(latest.llm_cost_micros)}`}
                  sub={`Speech-to-text ${fmtDollars(latest.stt_cost_micros)} · Text-to-speech ${fmtDollars(latest.tts_cost_micros)}`}
                />
              </div>
            );
          })()}

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
                    <th className="px-4 py-3">LLM</th>
                    <th className="px-4 py-3">Speech-to-text</th>
                    <th className="px-4 py-3">Text-to-speech</th>
                    <th className="px-4 py-3">Total</th>
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
                      <td className="px-4 py-3 text-ink">{fmtDollars(b.llm_cost_micros)}</td>
                      <td className="px-4 py-3 text-ink">{fmtDollars(b.stt_cost_micros)}</td>
                      <td className="px-4 py-3 text-ink">{fmtDollars(b.tts_cost_micros)}</td>
                      <td className="px-4 py-3 font-semibold text-ink">{fmtDollars(b.total_cost_micros)}</td>
                      <td className="px-4 py-3 text-ink">{fmtMaybeDollars(b.cost_per_active_user_micros)}</td>
                      <td className="px-4 py-3 text-ink">{fmtMaybeDollars(b.cost_per_voice_minute_micros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <h3 className="mt-8 text-lg font-semibold text-ink">Top 10 parents by cost (last 30 days)</h3>
          <p className="mt-1 text-base text-muted">
            Pseudonymous refs only. Look for one parent far above the rest: it can mean a leaked talk link.
          </p>
          <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-cloud">
            {!data.top_spenders || data.top_spenders.length === 0 ? (
              <p className="p-6 text-base text-muted">No usage in the last 30 days.</p>
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3">Parent ref</th>
                    <th className="px-4 py-3">Conversations</th>
                    <th className="px-4 py-3">Voice minutes</th>
                    <th className="px-4 py-3">LLM</th>
                    <th className="px-4 py-3">Speech</th>
                    <th className="px-4 py-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_spenders.map((t) => (
                    <tr key={t.parent_ref} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-mono text-ink">{t.parent_ref}</td>
                      <td className="px-4 py-3 text-ink">{t.conversations}</td>
                      <td className="px-4 py-3 text-ink">{t.voice_minutes.toFixed(1)}</td>
                      <td className="px-4 py-3 text-ink">{fmtDollars(t.llm_cost_micros)}</td>
                      <td className="px-4 py-3 text-ink">{fmtDollars(t.speech_cost_micros)}</td>
                      <td className="px-4 py-3 font-semibold text-ink">{fmtDollars(t.total_cost_micros)}</td>
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
