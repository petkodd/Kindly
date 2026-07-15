'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';

export interface Parent {
  id: string;
  first_name: string;
  relationship?: string;
}

export interface UseParents {
  /** The buyer's parents, or null while the initial load is in flight. */
  parents: Parent[] | null;
  /** The id of the currently selected parent ('' until the list arrives). */
  selected: string;
  setSelected: (id: string) => void;
  /** Non-empty when the load failed for a reason other than auth (see below). */
  loadError: string;
}

/**
 * Loads the buyer's parents once on mount and tracks which one is selected.
 * Shared by the family-summary, referrals, and memories pages, which all scope
 * their content to a chosen parent.
 *
 * - Selects the first parent as soon as the list arrives.
 * - Redirects to /login on a 401 (unauthenticated); any other failure surfaces
 *   through `loadError` so the page can show it.
 */
export function useParents(): UseParents {
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

  return { parents, selected, setSelected, loadError };
}
