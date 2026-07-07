import type { Parent } from '@/hooks/useParents';

/** Pill row for choosing which parent the surrounding page is scoped to. */
export function ParentPicker({
  parents,
  selected,
  onSelect,
}: {
  parents: Parent[];
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
