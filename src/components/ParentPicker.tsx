import type { Parent } from '@/lib/types';

/** Pill row for choosing which parent the surrounding page is scoped to. */
export function ParentPicker({
  parents,
  selected,
  onSelect,
}: {
  /** Only the id and name are needed, so callers can pass any Parent-shaped rows. */
  parents: Pick<Parent, 'id' | 'first_name'>[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  // Nothing to choose with a single parent — callers render this unconditionally
  // instead of repeating a `parents.length > 1 &&` guard.
  if (parents.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {parents.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p.id)}
          aria-pressed={p.id === selected}
          className={`min-h-[2.75rem] rounded-full border-2 px-5 py-2 text-base font-semibold ${
            p.id === selected
              ? 'border-sageDeep bg-sageDeep text-cloud'
              : 'border-field bg-cloud text-ink hover:border-sageDeep'
          }`}
        >
          {p.first_name}
        </button>
      ))}
    </div>
  );
}
