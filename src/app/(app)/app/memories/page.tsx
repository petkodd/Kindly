'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';

interface Parent {
  id: string;
  first_name: string;
}

interface Memory {
  id: string;
  layer: 'profile' | 'core' | 'interest' | 'episodic' | 'sensitive';
  mem_key: string;
  mem_value: string;
  status: 'proposed' | 'confirmed' | 'retired';
  sensitivity: 'normal' | 'sensitive' | 'restricted';
}

export default function MemoriesPage() {
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
        <p className="eyebrow">What Kindly remembers</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Memories</h1>
        <p className="mt-2 text-base text-muted">
          Review what Kindly has learned. Confirm the things it picked up from conversations, and
          remove anything that isn&rsquo;t right.
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
            <div className="flex flex-wrap gap-2">
              {parents.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p.id)}
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
          )}
          {selected && <MemoriesPanel key={selected} parentId={selected} />}
        </>
      )}
    </div>
  );
}

function MemoriesPanel({ parentId }: { parentId: string }) {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [error, setError] = useState('');

  // Mutations refetch (rather than apply locally like family-summary does) on
  // purpose: confirm/dismiss move a row between the proposed and confirmed
  // sections, so a full reload is simpler and less error-prone than re-grouping.
  const load = useCallback(async () => {
    setError('');
    try {
      const r = await api.get<{ memories: Memory[] }>(`/api/parents/${parentId}/memories`);
      setMemories(r.memories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load memories.');
    }
  }, [parentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-base text-clay">{error}</p>;
  if (!memories) return <p className="text-base text-muted">Loading memories…</p>;

  const proposed = memories.filter((m) => m.status === 'proposed');
  const confirmed = memories.filter((m) => m.status === 'confirmed');

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold text-ink">Suggested from conversations</h2>
        <p className="mt-1 text-base text-muted">
          Kindly noticed these. Confirm the ones that are right.
        </p>
        {proposed.length === 0 ? (
          <p className="mt-4 text-base text-muted">Nothing waiting for review.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {proposed.map((m) => (
              <MemoryRow key={m.id} memory={m} onChanged={load} kind="proposed" />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink">Confirmed memories</h2>
        {confirmed.length === 0 ? (
          <p className="mt-4 text-base text-muted">No confirmed memories yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {confirmed.map((m) => (
              <MemoryRow key={m.id} memory={m} onChanged={load} kind="confirmed" />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const LAYER_LABEL: Record<Memory['layer'], string> = {
  profile: 'Profile',
  core: 'Core',
  interest: 'Interest',
  episodic: 'Moment',
  sensitive: 'Sensitive',
};

function MemoryRow({
  memory,
  onChanged,
  kind,
}: {
  memory: Memory;
  onChanged: () => void;
  kind: 'proposed' | 'confirmed';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function act(run: () => Promise<unknown>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError('');
    setBusy(true);
    try {
      await run();
      // On success the row leaves this list (confirm → confirmed section,
      // dismiss → retired, remove → gone), so onChanged() refetches and this
      // row unmounts — that's why busy is intentionally not reset here.
      onChanged();
    } catch (err) {
      // Surface the server's reason (e.g. a 409 "not in a proposed state" from a
      // concurrent tab) rather than a generic, misleading "try again".
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  const confirm = () => act(() => api.patch(`/api/memories/${memory.id}`, { action: 'confirm' }));
  const dismiss = () =>
    act(
      () => api.patch(`/api/memories/${memory.id}`, { action: 'retire' }),
      'Dismiss this suggestion?',
    );
  const remove = () =>
    act(() => api.del(`/api/memories/${memory.id}`), 'Remove this memory? This cannot be undone.');

  return (
    <li className="rounded-xl border border-line bg-cloud p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-base text-ink">{memory.mem_value}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted">
              {LAYER_LABEL[memory.layer]}
            </span>
            {memory.sensitivity !== 'normal' && (
              <span className="rounded-full border border-clay px-2 py-0.5 text-xs font-semibold text-clay">
                {memory.sensitivity === 'restricted' ? 'Private — not shared' : 'Sensitive'}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {kind === 'proposed' ? (
            <>
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                className="btn-primary disabled:opacity-60"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={dismiss}
                disabled={busy}
                className="text-sm text-muted underline disabled:opacity-60"
              >
                Dismiss
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="text-sm text-clay underline disabled:opacity-60"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-clay">{error}</p>}
    </li>
  );
}
