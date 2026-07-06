'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';

export interface ParentOption {
  id: string;
  first_name: string;
}

/**
 * Load the signed-in buyer's parents and track the selected one. Shared by every
 * per-parent app page (family-summary, referrals, memories): fetch on mount,
 * auto-select the first parent, and redirect to /login on a 401.
 *
 * `parents` is null while loading. `loadError` is a user-facing message.
 */
export function useParents() {
  const router = useRouter();
  const [parents, setParents] = useState<ParentOption[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    api
      .get<{ parents: ParentOption[] }>('/api/parents')
      .then((r) => {
        setParents(r.parents);
        if (r.parents.length > 0) setSelected(r.parents[0].id);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/login');
        else setLoadError('Could not load your family.');
      });
  }, [router]);

  return { parents, selected, setSelected, loadError };
}

/** Pill row for choosing which parent to view. Renders nothing for a single parent. */
export function ParentPicker({
  parents,
  selected,
  onSelect,
}: {
  parents: ParentOption[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  if (parents.length <= 1) return null;
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

/** Empty state shown when the buyer hasn't set up a parent yet. */
export function NoParents() {
  return (
    <div className="rounded-xl border border-line bg-cloud p-6">
      <p className="text-base text-ink">You haven&rsquo;t set up a parent yet.</p>
      <Link href="/app/onboarding" className="btn-primary mt-4 inline-block">
        Set up the gift
      </Link>
    </div>
  );
}
