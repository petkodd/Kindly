'use client';

import type { ReactNode } from 'react';
import { useParents, type Parent } from '@/hooks/useParents';

interface ParentGateChildProps {
  /** The buyer's parents — guaranteed non-null (may be empty). */
  parents: Parent[];
  selected: string;
  setSelected: (id: string) => void;
}

/**
 * Shared scaffold for the per-parent buyer pages (family-summary, referrals,
 * memories, parent-profile). Loads the parents via useParents and renders the
 * common loading / error states, then hands a non-null `parents` list to
 * `children`. Each page still decides how to render the empty (0 parents) case,
 * so pages like referrals can keep showing content that doesn't depend on a
 * selected parent.
 */
export function ParentGate({ children }: { children: (props: ParentGateChildProps) => ReactNode }) {
  const { parents, selected, setSelected, loadError } = useParents();
  if (loadError) return <p className="text-base text-clay">{loadError}</p>;
  if (!parents) return <p className="text-base text-muted">Loading…</p>;
  return <>{children({ parents, selected, setSelected })}</>;
}
